// Internal-only PCM->text adapter for the MIT-licensed whisper.cpp runtime.
// IMPORTANT: isolated research spike. Production activation is forbidden until
// model hash verification, CI CVE scans, RSS/RTF and per-person consent pass #672.
#include "whisper.h"
#include "sha256.h"
#include "isolation.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cerrno>
#include <cmath>
#include <csignal>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#include <arpa/inet.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>

namespace {
constexpr int kPort = 8765;
constexpr int kMaxActiveConnections = 8;
constexpr int kMaxHeadersBytes = 4096;
constexpr int kMaxPcmBytes = 48000 * 2 * 10;
constexpr int kMaxTranscriptChars = 4000;
constexpr int kReadTimeoutSeconds = 10;
using Clock = std::chrono::steady_clock;
constexpr double kPi = 3.14159265358979323846;

struct Request {
    std::string method;
    std::string path;
    std::unordered_map<std::string, std::string> headers;
};

std::string lower(std::string s) {
    for (char & ch : s) {
        if (ch >= 'A' && ch <= 'Z') ch = static_cast<char>(ch + 'a' - 'A');
    }
    return s;
}
std::string trim(std::string s) {
    const auto first = s.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return {};
    const auto last = s.find_last_not_of(" \t\r\n");
    return s.substr(first, last - first + 1);
}
bool fixed_time_equal(const std::string & lhs, const std::string & rhs) {
    unsigned diff = static_cast<unsigned>(lhs.size() ^ rhs.size());
    const size_t max_size = std::max(lhs.size(), rhs.size());
    for (size_t i = 0; i < max_size; ++i) {
        const unsigned a = i < lhs.size() ? static_cast<unsigned char>(lhs[i]) : 0U;
        const unsigned b = i < rhs.size() ? static_cast<unsigned char>(rhs[i]) : 0U;
        diff |= a ^ b;
    }
    return diff == 0;
}
bool parse_headers(const std::string & raw, Request & request) {
    std::istringstream in(raw);
    std::string first;
    if (!std::getline(in, first)) return false;
    if (!first.empty() && first.back() == '\r') first.pop_back();
    std::string version, extra;
    std::istringstream start(first);
    if (!(start >> request.method >> request.path >> version) || (start >> extra) ||
        (version != "HTTP/1.1" && version != "HTTP/1.0")) return false;
    std::string line;
    while (std::getline(in, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (line.empty()) break;
        if (line[0] == ' ' || line[0] == '\t') return false;
        const auto colon = line.find(':');
        if (colon == std::string::npos || colon == 0) return false;
        const std::string name = lower(trim(line.substr(0, colon)));
        const std::string value = trim(line.substr(colon + 1));
        if (name.empty() || request.headers.count(name) != 0) return false;
        request.headers.emplace(name, value);
    }
    // Reject HTTP request smuggling and unknown transfer encodings.
    return request.headers.count("transfer-encoding") == 0;
}
std::string header(const Request & request, const std::string & name) {
    auto it = request.headers.find(name);
    return it == request.headers.end() ? "" : it->second;
}
bool parse_body_length(const std::string & value, size_t & length) {
    if (value.empty() || value.size() > 7) return false;
    size_t result = 0;
    for (char c : value) {
        if (c < '0' || c > '9') return false;
        result = result * 10U + static_cast<unsigned>(c - '0');
        if (result > kMaxPcmBytes) return false;
    }
    if (result < 2 || (result % 2) != 0) return false;
    length = result;
    return true;
}
bool send_all(int fd, const std::string & data) {
    size_t pos = 0;
    while (pos < data.size()) {
        const ssize_t written = send(fd, data.data() + pos, data.size() - pos, MSG_NOSIGNAL);
        if (written <= 0) return false;
        pos += static_cast<size_t>(written);
    }
    return true;
}
void respond(int fd, int status, const std::string & body) {
    const char * reason = "Internal Server Error";
    switch (status) {
        case 200: reason = "OK"; break;
        case 400: reason = "Bad Request"; break;
        case 403: reason = "Forbidden"; break;
        case 404: reason = "Not Found"; break;
        case 413: reason = "Payload Too Large"; break;
        case 415: reason = "Unsupported Media Type"; break;
        case 422: reason = "Unprocessable Content"; break;
        case 429: reason = "Too Many Requests"; break;
        case 503: reason = "Service Unavailable"; break;
    }
    std::string response = "HTTP/1.1 " + std::to_string(status) + " " + reason +
        "\r\nContent-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\n" +
        "Connection: close\r\nContent-Length: " + std::to_string(body.size()) +
        "\r\n\r\n" + body;
    (void)send_all(fd, response);
}
// A single absolute deadline prevents slow-header/body drip traffic from
// resetting SO_RCVTIMEO repeatedly. No audio is persisted while waiting.
bool receive_exact(int fd, void * output, size_t length, Clock::time_point deadline) {
    size_t total = 0;
    auto * bytes = static_cast<uint8_t *>(output);
    while (total < length) {
        const auto now = Clock::now();
        if (now >= deadline) return false;
        const auto left = std::chrono::duration_cast<std::chrono::milliseconds>(deadline-now);
        const int timeout_ms = static_cast<int>(std::min<int64_t>(left.count(), 10000));
        pollfd descriptor{fd, POLLIN, 0};
        const int ready = poll(&descriptor, 1, std::max(timeout_ms,1));
        if (ready < 0 && errno == EINTR) continue;
        if (ready <= 0 || (descriptor.revents & (POLLERR | POLLNVAL))) return false;
        const ssize_t n = recv(fd, bytes + total, length - total, MSG_DONTWAIT);
        if (n < 0 && (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK)) continue;
        if (n <= 0) return false;
        total += static_cast<size_t>(n);
    }
    return true;
}
bool read_headers(int fd, std::string & raw, Clock::time_point deadline) {
    raw.reserve(512);
    char c;
    while (raw.size() < kMaxHeadersBytes) {
        if (!receive_exact(fd, &c, 1, deadline)) return false;
        raw.push_back(c);
        if (raw.size() >= 4 && raw.compare(raw.size() - 4, 4, "\r\n\r\n") == 0)
            return true;
    }
    return false;
}
bool read_body(int fd, std::vector<uint8_t> & bytes, size_t length,
               Clock::time_point deadline) {
    bytes.resize(length);
    return receive_exact(fd, bytes.data(), length, deadline);
}
std::string json_escape(const std::string & text) {
    const char * hex = "0123456789abcdef";
    std::string json = "{\"text\":\"";
    int count = 0;
    for (size_t i = 0; i < text.size() && count < kMaxTranscriptChars;) {
        const unsigned char c = static_cast<unsigned char>(text[i]);
        // Avoid splitting UTF-8 code points at the 4000-character bound.
        const size_t width = c < 0x80 ? 1 : c < 0xe0 ? 2 : c < 0xf0 ? 3 : 4;
        if (i + width > text.size()) break;
        if (c < 0x20) {
            json += "\\u00";
            json += hex[(c >> 4) & 15];
            json += hex[c & 15];
        } else if (c == '"' || c == '\\') {
            json += '\\';
            json += static_cast<char>(c);
        } else {
            json.append(text, i, width);
        }
        i += width;
        ++count;
    }
    json += "\"}";
    return json;
}
std::vector<float> downsample_to_16k(const std::vector<uint8_t> & pcm) {
    const size_t count = pcm.size() / 2U;
    std::vector<float> in(count);
    for (size_t i = 0; i < count; ++i) {
        const uint16_t raw = static_cast<uint16_t>(pcm[2*i]) |
            (static_cast<uint16_t>(pcm[2*i+1]) << 8U);
        in[i] = static_cast<float>(static_cast<int16_t>(raw)) / 32768.0f;
    }
    // 31-tap normalized low-pass FIR before decimation by three.
    double taps[31];
    double sum = 0.0;
    for (int i = -15; i <= 15; ++i) {
        const double x = i / 3.0;
        const double sinc = i == 0 ? 1.0 : std::sin(kPi * x) / (kPi * x);
        const double window = 0.54 + 0.46 * std::cos(kPi * i / 15.0);
        taps[i+15] = sinc * window;
        sum += taps[i+15];
    }
    std::vector<float> out((count + 2U) / 3U);
    for (size_t i = 0; i < out.size(); ++i) {
        double s = 0.0;
        for (int j = -15; j <= 15; ++j) {
            const int64_t idx = static_cast<int64_t>(i * 3U) + j;
            if (idx >= 0 && static_cast<size_t>(idx) < count)
                s += in[static_cast<size_t>(idx)] * taps[j+15];
        }
        out[i] = static_cast<float>(s / sum);
    }
    return out;
}

struct Runtime {
    std::mutex inference;
    std::string model_path;
    std::string secret;
};

// Runs in an exec'd separate OS process. No HTTP port or bearer credentials
// are inherited, and only one bounded PCM chunk is received on stdin.
int run_infer_child(const char * model_path) {
    if (!model_path || !verify_pinned_model_sha256(model_path)) return 1;
    std::vector<uint8_t> data;
    data.reserve(64000);
    uint8_t buffer[4096];
    for (;;) {
        const ssize_t n = read(STDIN_FILENO, buffer, sizeof(buffer));
        if (n == 0) break;
        if (n < 0 && errno == EINTR) continue;
        if (n < 0) return 1;
        if (data.size() + static_cast<size_t>(n) > isolation::kMaxFloatBytes) return 1;
        data.insert(data.end(), buffer, buffer + n);
    }
    if (data.empty() || data.size() % sizeof(float) != 0) return 1;
    std::vector<float> samples(data.size() / sizeof(float));
    std::memcpy(samples.data(), data.data(), data.size());
    data.clear();

    whisper_context_params cparams = whisper_context_default_params();
    cparams.use_gpu = false;
    whisper_context * ctx = whisper_init_from_file_with_params(model_path, cparams);
    if (!ctx) return 1;
    whisper_full_params params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    params.n_threads = 1;
    params.language = "ja";
    params.translate = false;
    params.no_timestamps = true;
    params.single_segment = true;
    params.print_progress = false;
    params.print_realtime = false;
    params.print_timestamps = false;
    params.print_special = false;
    params.no_context = true;
    params.greedy.best_of = 1;
    const bool ok = whisper_full(ctx, params, samples.data(), static_cast<int>(samples.size())) == 0;
    std::string transcript;
    if (ok) {
        const int n = whisper_full_n_segments(ctx);
        for (int i = 0; i < n; ++i) {
            const char * segment = whisper_full_get_segment_text(ctx, i);
            if (segment) transcript += segment;
            if (transcript.size() >= 16000U) break;
        }
    }
    whisper_free(ctx);
    if (!ok) return 1;
    const auto response = json_escape(trim(transcript));
    return isolation::send_to_stdout(response) ? 0 : 1;
}

void process_connection(int fd, Runtime & runtime) {
    timeval timeout{};
    timeout.tv_sec = kReadTimeoutSeconds;
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
    std::string raw;
    Request req;
    const auto request_deadline = Clock::now() + std::chrono::seconds(kReadTimeoutSeconds);
    if (!read_headers(fd, raw, request_deadline) || !parse_headers(raw, req)) {
        respond(fd, 400, "{\"error\":\"invalid_request\"}");
        return;
    }
    if (req.method == "GET" && req.path == "/healthz") {
        respond(fd, 200, "{\"status\":\"ready\"}");
        return;
    }
    if (req.method != "POST" || req.path != "/v1/transcribe") {
        respond(fd, 404, "{\"error\":\"not_found\"}");
        return;
    }
    if (!fixed_time_equal(header(req, "authorization"), "Bearer " + runtime.secret)) {
        respond(fd, 403, "{\"error\":\"forbidden\"}");
        return;
    }
    if (header(req, "content-type") != "application/octet-stream") {
        respond(fd, 415, "{\"error\":\"invalid_content_type\"}");
        return;
    }
    if (header(req, "x-audio-sample-rate") != "48000") {
        respond(fd, 422, "{\"error\":\"invalid_sample_rate\"}");
        return;
    }
    size_t size = 0;
    if (!parse_body_length(header(req, "content-length"), size)) {
        respond(fd, 413, "{\"error\":\"invalid_audio_size\"}");
        return;
    }
    // Never store PCM to a file. Limit each request to 10s / 960kB.
    std::vector<uint8_t> pcm;
    if (!read_body(fd, pcm, size, request_deadline)) {
        respond(fd, 400, "{\"error\":\"truncated_audio\"}");
        return;
    }
    std::unique_lock<std::mutex> lock(runtime.inference, std::try_to_lock);
    if (!lock.owns_lock()) {
        respond(fd, 429, "{\"error\":\"worker_busy\"}");
        return;
    }
    const auto f32 = downsample_to_16k(pcm);
    pcm.clear();
    pcm.shrink_to_fit();

    // An HTTP abort or deadline kills the actual decode OS process. Do not
    // rely on whisper.cpp's cooperative abort_callback or a detached thread.
    const auto result = isolation::run(
        runtime.model_path, f32, fd, std::chrono::seconds(18));
    if (!result.ok) {
        respond(fd, 503, "{\"error\":\"transcription_unavailable\"}");
        return;
    }
    respond(fd, 200, result.body);
}
int self_test() {
    // FIPS SHA-256 known-answer tests; do not weaken the production model pin.
    if (sha256_string("") != "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855") return 9;
    if (sha256_string("abc") != "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad") return 10;
    Request r;
    if (!parse_headers("POST /v1/transcribe HTTP/1.1\r\nContent-Length: 960\r\n\r\n", r)) return 1;
    size_t size = 0;
    if (!parse_body_length(header(r, "content-length"), size) || size != 960U) return 2;
    if (parse_body_length("960001", size) || parse_body_length("-2", size)) return 3;
    if (!fixed_time_equal("Bearer abc", "Bearer abc") ||
        fixed_time_equal("Bearer abc", "Bearer abd")) return 4;
    Request duplicate;
    if (parse_headers("POST /v1/transcribe HTTP/1.1\r\nContent-Length: 2\r\nContent-Length: 3\r\n\r\n", duplicate)) return 5;
    Request te;
    if (parse_headers("POST /v1/transcribe HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n", te)) return 6;
    std::vector<uint8_t> silence(48000U * 2U, 0U);
    const auto downsampled = downsample_to_16k(silence);
    if (downsampled.size() != 16000U || downsampled[0] != 0.0f) return 7;
    if (json_escape("a\n\"b") != "{\"text\":\"a\\u000a\\\"b\"}") return 8;
    char one = 0;
    if (receive_exact(-1, &one, 1, Clock::now()-std::chrono::seconds(1))) return 11;
    // No-model synthetic isolation test: the actual sleeping child must die
    // under our hard deadline, not merely detach from the request thread.
    const auto t0 = Clock::now();
    auto killed = isolation::run("", std::vector<float>(2, 0.0f), -1,
                                 std::chrono::milliseconds(180), "--sleep-child-test");
    if (killed.ok || !killed.terminated ||
        Clock::now() - t0 > std::chrono::seconds(3)) return 12;
    return 0;
}
} // namespace

int main(int argc, char ** argv) {
    if (argc == 2 && std::strcmp(argv[1], "--self-test") == 0) return self_test();
    if (argc == 3 && std::strcmp(argv[1], "--infer-child") == 0)
        return run_infer_child(argv[2]);
    if (argc == 3 && std::strcmp(argv[1], "--sleep-child-test") == 0) {
        sleep(60);
        return 0;
    }
    std::signal(SIGPIPE, SIG_IGN);
    const char * secret = std::getenv("VC_RECAP_LOCAL_WHISPER_TOKEN");
    const char * model = std::getenv("WHISPER_MODEL_PATH");
    // Only an offline, fixed-revision multilingual GGML tiny model is accepted.
    // Any missing, changed, symlinked or unapproved model fails closed.
    if (!secret || std::strlen(secret) < 32 || !model || model[0] != '/' ||
        !verify_pinned_model_sha256(model)) return 1;
    whisper_context_params cparams = whisper_context_default_params();
    cparams.use_gpu = false;
    whisper_context * ctx = whisper_init_from_file_with_params(model, cparams);
    if (!ctx) return 1;
    // Load model once to prove the health endpoint will be meaningful, then
    // release its parent-process RSS. Every individual decoding process
    // re-verifies the model, loads it, and is reaped before the next request.
    whisper_free(ctx);
    Runtime runtime;
    runtime.model_path = model;
    runtime.secret = secret;
    int listener = socket(AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0);
    if (listener < 0) return 1;
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_ANY); // Compose private network only
    addr.sin_port = htons(kPort);
    int reuse = 1;
    setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));
    if (bind(listener, reinterpret_cast<sockaddr *>(&addr), sizeof(addr)) != 0 ||
        listen(listener, 8) != 0) return 1;
    std::atomic<int> active{0};
    for (;;) {
        const int fd = accept4(listener, nullptr, nullptr, SOCK_CLOEXEC);
        if (fd < 0) {
            if (errno == EINTR) continue;
            break;
        }
        if (active.load() >= kMaxActiveConnections) {
            respond(fd, 429, "{\"error\":\"worker_busy\"}");
            close(fd);
            continue;
        }
        active.fetch_add(1);
        std::thread([fd, &runtime, &active] {
            try {
                process_connection(fd, runtime);
            } catch (...) {
                respond(fd, 503, "{\"error\":\"transcription_unavailable\"}");
            }
            close(fd);
            active.fetch_sub(1);
        }).detach();
    }
    close(listener);
    return 1;
}
