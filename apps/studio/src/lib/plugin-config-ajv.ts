import Ajv from 'ajv';

/**
 * Plugin ManifestのJSON Schema検証に使うAjvを生成する。
 *
 * `x-herta-ui` はConfig Studio専用の表示metadataであり、
 * JSON Schema上の値制約には影響しない。Ajvのstrict modeは維持したまま
 * このHerta固有keywordだけを明示的に許可する。
 */
export function createPluginConfigAjv(): Ajv {
  const ajv = new Ajv({ allErrors: true, useDefaults: true });
  ajv.addKeyword({
    keyword: 'x-herta-ui',
    schemaType: 'object',
    valid: true,
  });
  return ajv;
}
