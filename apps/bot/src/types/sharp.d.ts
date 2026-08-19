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
  }

  export interface SharpOutputInfo {
    width: number;
    height: number;
    channels: number;
  }

  export interface Sharp {
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
  }

  export interface SharpFactory {
    (
      input?: Buffer | Uint8Array | string | SharpCreateInput,
      options?: SharpFactoryOptions,
    ): Sharp;
  }

  const sharp: SharpFactory;
  export default sharp;
}
