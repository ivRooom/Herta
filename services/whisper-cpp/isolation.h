// POSIX-only containment of the native ASR call. A separate exec'd process
// holds the decode state, so socket abort or wall-clock timeout can SIGKILL it.
// No audio is written to disk; IPC is via bounded anonymous pipes only.
#pragma once

#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cstdint>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <string>
#include <sys/socket.h>
#include <sys/wait.h>
#include <unistd.h>
#include <vector>

namespace isolation {
using Clock = std::chrono::steady_clock;
constexpr size_t kMaxFloatBytes = 160000U * sizeof(float);
constexpr size_t kMaxReplyBytes = 16000U;

inline void close_if_open(int & fd) {
    if (fd >= 0) { close(fd); fd = -1; }
}

inline bool set_nonblocking(int fd) {
    const int flags = fcntl(fd, F_GETFL);
    return flags >= 0 && fcntl(fd, F_SETFL, flags | O_NONBLOCK) == 0;
}

// Only after the request body is fully received. A peer that fully disconnects
// triggers HUP/EOF; an idle HTTP keep-alive connection is not cancelled.
inline bool peer_gone(int fd) {
    if (fd < 0) return false; // synthetic self-test has no network socket
    pollfd sock{fd, static_cast<short>(POLLIN | POLLHUP | POLLERR), 0};
    const int ready = poll(&sock, 1, 0);
    if (ready < 0) return errno != EINTR;
    if (ready == 0) return false;
    if (sock.revents & (POLLHUP | POLLERR | POLLNVAL)) return true;
#ifdef POLLRDHUP
    if (sock.revents & POLLRDHUP) return true;
#endif
    if (sock.revents & POLLIN) {
        char scratch;
        const ssize_t n = recv(fd, &scratch, 1, MSG_PEEK | MSG_DONTWAIT);
        return n == 0;
    }
    return false;
}

// Child process stdout is a private pipe, never an application log.
inline bool send_to_stdout(const std::string & message) {
    size_t at = 0;
    while (at < message.size()) {
        const ssize_t n = write(STDOUT_FILENO, message.data() + at, message.size() - at);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) return false;
        at += static_cast<size_t>(n);
    }
    return true;
}

struct Result {
    bool ok = false;
    bool terminated = false;
    std::string body;
};

// The child receives a clean environment: neither bearer token nor any other
// application secret is propagated. The model file path is not secret.
inline Result run(
    const std::string & model_path,
    const std::vector<float> & samples,
    int client_fd,
    std::chrono::milliseconds deadline,
    const char * mode = "--infer-child"
) {
    Result result;
    if (samples.empty() || samples.size() * sizeof(float) > kMaxFloatBytes) return result;
    int input[2]{-1, -1};
    int output[2]{-1, -1};
    if (pipe2(input, O_CLOEXEC) != 0) return result;
    if (pipe2(output, O_CLOEXEC) != 0) {
        close_if_open(input[0]); close_if_open(input[1]);
        return result;
    }
    pid_t pid = fork();
    if (pid < 0) {
        close_if_open(input[0]); close_if_open(input[1]);
        close_if_open(output[0]); close_if_open(output[1]);
        return result;
    }
    if (pid == 0) {
        // After fork in a multithreaded process: async-signal-safe calls only.
        if (dup2(input[0], STDIN_FILENO) < 0 ||
            dup2(output[1], STDOUT_FILENO) < 0) _exit(127);
        close(input[0]); close(input[1]);
        close(output[0]); close(output[1]);
        const char * args[] = {"/app/herta-whisper-cpp", mode, model_path.c_str(), nullptr};
        const char * env[] = {nullptr};
        execve(args[0], const_cast<char * const *>(args), const_cast<char * const *>(env));
        _exit(127);
    }

    close_if_open(input[0]); close_if_open(output[1]);
    const bool nonblocking = set_nonblocking(input[1]) && set_nonblocking(output[0]);
    const auto end = Clock::now() + deadline;
    const char * bytes = reinterpret_cast<const char *>(samples.data());
    const size_t total = samples.size() * sizeof(float);
    size_t pos = 0;
    bool output_eof = false;
    bool child_exited = false;
    int status = 0;
    bool failed = !nonblocking;
    while (!failed && Clock::now() < end) {
        if (peer_gone(client_fd)) { result.terminated = true; break; }
        pollfd channels[2]{};
        channels[0] = {input[1], static_cast<short>(input[1] >= 0 ? POLLOUT : 0), 0};
        channels[1] = {output[0], static_cast<short>(POLLIN | POLLHUP), 0};
        const int ready = poll(channels, 2, 50);
        if (ready < 0 && errno != EINTR) { failed = true; break; }

        if (input[1] >= 0 && (channels[0].revents & POLLOUT)) {
            const ssize_t n = write(input[1], bytes + pos, total - pos);
            if (n > 0) pos += static_cast<size_t>(n);
            else if (n < 0 && errno != EAGAIN && errno != EINTR) failed = true;
            if (pos == total) close_if_open(input[1]);
        }
        if (channels[0].revents & (POLLERR | POLLNVAL)) failed = true;
        if (output[0] >= 0 && (channels[1].revents & (POLLIN | POLLHUP))) {
            char chunk[2048];
            const ssize_t n = read(output[0], chunk, sizeof(chunk));
            if (n > 0) {
                if (result.body.size() + static_cast<size_t>(n) > kMaxReplyBytes) failed = true;
                else result.body.append(chunk, static_cast<size_t>(n));
            } else if (n == 0) {
                output_eof = true;
                close_if_open(output[0]);
            } else if (errno != EINTR && errno != EAGAIN) failed = true;
        }
        if (channels[1].revents & (POLLERR | POLLNVAL)) failed = true;
        if (!child_exited) {
            const pid_t reaped = waitpid(pid, &status, WNOHANG);
            if (reaped == pid) child_exited = true;
            else if (reaped < 0 && errno != EINTR) failed = true;
        }
        if (child_exited && output_eof) {
            result.ok = !failed && pos == total && WIFEXITED(status) &&
                        WEXITSTATUS(status) == 0 && !result.body.empty() &&
                        !peer_gone(client_fd);
            break;
        }
    }
    close_if_open(input[1]); close_if_open(output[0]);
    if (!child_exited) {
        // No signal handler in whisper.cpp can guarantee native immediate
        // cancellation; kill the isolated decode process and reap it.
        kill(pid, SIGKILL);
        for (;;) {
            if (waitpid(pid, &status, 0) == pid) break;
            if (errno != EINTR) break;
        }
        result.terminated = true;
    }
    if (!result.ok) result.body.clear();
    return result;
}
} // namespace isolation
