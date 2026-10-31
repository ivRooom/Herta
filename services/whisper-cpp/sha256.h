// Minimal SHA-256 implementation of the FIPS 180-4 algorithm.
// No OpenSSL, dynamic crypto library or external executable is required by
// the static scratch runtime. Used only for a pinned public model artifact.
#pragma once
#include <array>
#include <cstddef>
#include <cstdint>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <string>
#include <sys/stat.h>

class Sha256 {
    std::array<uint32_t, 8> h_{
        0x6a09e667U, 0xbb67ae85U, 0x3c6ef372U, 0xa54ff53aU,
        0x510e527fU, 0x9b05688cU, 0x1f83d9abU, 0x5be0cd19U
    };
    std::array<uint8_t, 64> block_{};
    uint64_t total_ = 0;
    size_t used_ = 0;
    static uint32_t rotr(uint32_t n, int d) {
        return (n >> d) | (n << (32 - d));
    }
    void compress() {
        static constexpr std::array<uint32_t, 64> k = {
            0x428a2f98U,0x71374491U,0xb5c0fbcfU,0xe9b5dba5U,0x3956c25bU,0x59f111f1U,0x923f82a4U,0xab1c5ed5U,
            0xd807aa98U,0x12835b01U,0x243185beU,0x550c7dc3U,0x72be5d74U,0x80deb1feU,0x9bdc06a7U,0xc19bf174U,
            0xe49b69c1U,0xefbe4786U,0x0fc19dc6U,0x240ca1ccU,0x2de92c6fU,0x4a7484aaU,0x5cb0a9dcU,0x76f988daU,
            0x983e5152U,0xa831c66dU,0xb00327c8U,0xbf597fc7U,0xc6e00bf3U,0xd5a79147U,0x06ca6351U,0x14292967U,
            0x27b70a85U,0x2e1b2138U,0x4d2c6dfcU,0x53380d13U,0x650a7354U,0x766a0abbU,0x81c2c92eU,0x92722c85U,
            0xa2bfe8a1U,0xa81a664bU,0xc24b8b70U,0xc76c51a3U,0xd192e819U,0xd6990624U,0xf40e3585U,0x106aa070U,
            0x19a4c116U,0x1e376c08U,0x2748774cU,0x34b0bcb5U,0x391c0cb3U,0x4ed8aa4aU,0x5b9cca4fU,0x682e6ff3U,
            0x748f82eeU,0x78a5636fU,0x84c87814U,0x8cc70208U,0x90befffaU,0xa4506cebU,0xbef9a3f7U,0xc67178f2U
        };
        std::array<uint32_t, 64> w{};
        for (int i = 0; i < 16; ++i) {
            const size_t j = static_cast<size_t>(i) * 4;
            w[static_cast<size_t>(i)] =
                (uint32_t(block_[j]) << 24U) | (uint32_t(block_[j+1]) << 16U) |
                (uint32_t(block_[j+2]) << 8U) | uint32_t(block_[j+3]);
        }
        for (int i = 16; i < 64; ++i) {
            const uint32_t a = w[static_cast<size_t>(i-15)];
            const uint32_t b = w[static_cast<size_t>(i-2)];
            const uint32_t s0 = rotr(a,7) ^ rotr(a,18) ^ (a >> 3);
            const uint32_t s1 = rotr(b,17) ^ rotr(b,19) ^ (b >> 10);
            w[static_cast<size_t>(i)] = w[static_cast<size_t>(i-16)] + s0 +
                w[static_cast<size_t>(i-7)] + s1;
        }
        uint32_t a=h_[0], b=h_[1], c=h_[2], d=h_[3], e=h_[4], f=h_[5], g=h_[6], h=h_[7];
        for (int i = 0; i < 64; ++i) {
            const uint32_t s1=rotr(e,6)^rotr(e,11)^rotr(e,25);
            const uint32_t ch=(e&f)^(~e&g);
            const uint32_t t1=h+s1+ch+k[static_cast<size_t>(i)]+w[static_cast<size_t>(i)];
            const uint32_t s0=rotr(a,2)^rotr(a,13)^rotr(a,22);
            const uint32_t maj=(a&b)^(a&c)^(b&c);
            const uint32_t t2=s0+maj;
            h=g;g=f;f=e;e=d+t1;d=c;c=b;b=a;a=t1+t2;
        }
        h_[0]+=a;h_[1]+=b;h_[2]+=c;h_[3]+=d;
        h_[4]+=e;h_[5]+=f;h_[6]+=g;h_[7]+=h;
    }
public:
    void update(const uint8_t * data, size_t size) {
        total_ += static_cast<uint64_t>(size);
        for (size_t i=0; i<size; ++i) {
            block_[used_++] = data[i];
            if (used_ == 64U) {
                compress();
                used_ = 0;
            }
        }
    }
    std::string finish() {
        const uint64_t bits = total_ * 8U;
        const uint8_t one = 0x80;
        update(&one,1);
        const uint8_t zero = 0;
        while (used_ != 56U) update(&zero,1);
        uint8_t length[8]{};
        for (int i=0; i<8; ++i)
            length[static_cast<size_t>(7-i)] = static_cast<uint8_t>(bits >> (i*8));
        update(length,8);
        std::ostringstream out;
        out << std::hex << std::setfill('0');
        for (uint32_t v : h_) out << std::setw(8) << v;
        return out.str();
    }
};

inline std::string sha256_string(const std::string & data) {
    Sha256 h;
    h.update(reinterpret_cast<const uint8_t *>(data.data()), data.size());
    return h.finish();
}

inline bool verify_pinned_model_sha256(const std::string & filename) {
    // Upstream Hugging Face ggerganov/whisper.cpp GGML multilingual Tiny:
    // pinned repo revision 5359861c739e955e79d9a303bcbc70fb988958b1.
    // Publisher model-file SHA256 (not the Git SHA shown in model README).
    constexpr const char * expected =
        "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21";
    struct stat st{};
    if (lstat(filename.c_str(), &st) != 0 || !S_ISREG(st.st_mode) ||
        st.st_size < 70 * 1024 * 1024 || st.st_size > 90 * 1024 * 1024) return false;
    std::ifstream file(filename, std::ios::binary);
    if (!file) return false;
    Sha256 hash;
    std::array<uint8_t, 64 * 1024> buf{};
    while (file) {
        file.read(reinterpret_cast<char *>(buf.data()), static_cast<std::streamsize>(buf.size()));
        const auto count = file.gcount();
        if (count > 0) hash.update(buf.data(), static_cast<size_t>(count));
    }
    return file.eof() && hash.finish() == expected;
}
