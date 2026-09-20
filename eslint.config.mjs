// Repository-wide ESLint setup (L1 static gate). The rules live in
// packages/config so CI, the editor and the post-edit hook all use the same set.
import { trygghverdagEslintConfig } from '@trygghverdag/config/eslint/index.mjs';

export default trygghverdagEslintConfig({ rootDir: import.meta.dirname });
