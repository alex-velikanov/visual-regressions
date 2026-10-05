// Where things are. TOOL is the folder this tool's own code lives in; DATA is the folder a project's data lives in:
// pages.json, the baseline, the saved logins (.auth/), the run's screenshots and the report. vr.sh sets VR_DATA and runs
// from there. When VR_DATA is not set, DATA is the same folder as the code, which is how the tool has always worked, so the code
// can sit anywhere (fetched, updated, shared by several projects) and a project keeps only its own data.
import path from 'path';
import { fileURLToPath } from 'url';

export const TOOL = path.dirname(fileURLToPath(import.meta.url));
export const DATA = process.env.VR_DATA ? path.resolve(process.env.VR_DATA) : TOOL;
export const dataPath = (...parts) => path.join(DATA, ...parts);
