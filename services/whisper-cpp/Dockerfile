# Build tools stay in this stage. The deployed image is scratch (no shell,
# Python, pip, FFmpeg, dynamic loader or OS package manager).
FROM alpine:3.22 AS builder
RUN apk add --no-cache build-base cmake git linux-headers binutils
ARG WHISPER_CPP_COMMIT=d1be6fde11ac6e0407606b4e42fe72d34add8037
RUN git clone --no-checkout https://github.com/ggml-org/whisper.cpp.git /opt/whisper.cpp \
    && git -C /opt/whisper.cpp checkout --detach "${WHISPER_CPP_COMMIT}" \
    && test "$(git -C /opt/whisper.cpp rev-parse HEAD)" = "${WHISPER_CPP_COMMIT}"
COPY CMakeLists.txt main.cpp /work/
RUN cmake -S /work -B /build -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_EXE_LINKER_FLAGS="-static" \
    && cmake --build /build --parallel 2 \
    && /build/herta-whisper-cpp --self-test \
    && (readelf -l /build/herta-whisper-cpp | grep -q INTERP && exit 1 || true)

FROM scratch
COPY --from=builder /build/herta-whisper-cpp /app/herta-whisper-cpp
USER 10001:10001
EXPOSE 8765
ENTRYPOINT ["/app/herta-whisper-cpp"]
