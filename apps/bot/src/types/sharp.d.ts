declare module 'sharp' {
  export interface OverlayOptions {
    input: Buffer;
    left?: number;
    top?: number;
    blend?: string;
  }

  export interface Sharp {
    resize(
      width: number,
      height: number,
      options?: { fit?: 'cover' | 'fill' | 'contain' | 'inside' | 'outside' },
    ): Sharp;
    composite(overlays: OverlayOptions[]): Sharp;
    png(options?: { compressionLevel?: number; adaptiveFiltering?: boolean }): Sharp;
    toBuffer(): Promise<Buffer>;
  }

  export interface SharpFactory {
    (input?: Buffer | Uint8Array | string): Sharp;
  }

  const sharp: SharpFactory;
  export default sharp;
}
