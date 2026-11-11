declare module 'sharp' {
  export interface OverlayOptions {
    input: Buffer;
    left?: number;
    top?: number;
    blend?: string;
  }

  export interface SharpMetadata {
    width?: number;
    height?: number;
    format?: string;
    pages?: number;
    pageHeight?: number;
    delay?: number[];
    loop?: number;
  }

  export interface SharpOutputInfo {
    width: number;
    height: number;
    channels: number;
  }

  export interface Sharp {
    extract(region: { left: number; top: number; width: number; height: number }): Sharp;
    resize(
      width: number,
      height: number,
      options?: {
        fit?: 'cover' | 'fill' | 'contain' | 'inside' | 'outside';
        position?: string;
      },
    ): Sharp;
    composite(overlays: OverlayOptions[]): Sharp;
    png(options?: { compressionLevel?: number; adaptiveFiltering?: boolean }): Sharp;
    webp(options?: { quality?: number; delay?: number | number[]; loop?: number }): Sharp;
    gif(options?: { delay?: number | number[]; loop?: number }): Sharp;
    raw(): Sharp;
    metadata(): Promise<SharpMetadata>;
    toBuffer(): Promise<Buffer>;
    toBuffer(options: { resolveWithObject: true }): Promise<{
      data: Buffer;
      info: SharpOutputInfo;
    }>;
  }

  export interface SharpCreateInput {
    create: {
      width: number;
      height: number;
      channels: 3 | 4;
      background: { r: number; g: number; b: number; alpha?: number };
    };
  }

  export interface SharpFactoryOptions {
    limitInputPixels?: number | boolean;
    animated?: boolean;
    page?: number;
    join?: { animated?: boolean };
  }

  export interface SharpFactory {
    (
      input?: Buffer | Uint8Array | string | SharpCreateInput | Buffer[],
      options?: SharpFactoryOptions,
    ): Sharp;
  }

  const sharp: SharpFactory;
  export default sharp;
}
