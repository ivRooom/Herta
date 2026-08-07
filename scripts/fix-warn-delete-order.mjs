import { readFileSync, rmSync, writeFileSync } from 'node:fs';

const path = 'plugins/moderation/src/automatic-runtime.ts';
let source = readFileSync(path, 'utf8');
const before = `    case 'warn_delete': {\n      let warningError: unknown;\n      try {\n        await sendAutomaticWarning(message, policy, reason);\n      } catch (error) {\n        warningError = error;\n      }\n      await message.delete();\n      if (warningError) throw warningError;\n      return;\n    }`;
const after = `    case 'warn_delete': {\n      await message.delete();\n      await sendAutomaticWarning(message, policy, reason);\n      return;\n    }`;
if (!source.includes(before)) throw new Error('warn_delete置換対象が見つかりません');
source = source.replace(before, after);
writeFileSync(path, source);
rmSync('scripts/fix-warn-delete-order.mjs');
rmSync('.github/workflows/fix-warn-delete-order.yml');
