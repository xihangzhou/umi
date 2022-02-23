import { parse } from '@umijs/deps/compiled/dotenv';
import { existsSync, readFileSync } from 'fs';

/**
 * dotenv wrapper
 * @param envPath string
 */
export default function loadDotEnv(envPath: string): void {
  if (existsSync(envPath)) {
    const parsed = parse(readFileSync(envPath, 'utf-8')) || {}; //Parses a string or buffer in the .env file format into an object.
    Object.keys(parsed).forEach((key) => {
      // eslint-disable-next-line no-prototype-builtins
      if (!process.env.hasOwnProperty(key)) {
        // 遍历这个object把这些环境变量加入到process.env中
        process.env[key] = parsed[key];
      }
    });
  }
}
