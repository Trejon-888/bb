import path from "node:path";
import type { AcpNativeRootsResolver } from "./resolver.js";
import { skillsRoot } from "./shared.js";

const GEMINI_DIR_NAME = ".gemini";
const AGENTS_DIR_NAME = ".agents";

export const resolveGeminiNativeRoots: AcpNativeRootsResolver = async (
  args,
) => {
  const home = args.env.GEMINI_CLI_HOME || args.homeDir;
  return {
    skills: [
      skillsRoot({
        origin: "user",
        path: path.join(home, GEMINI_DIR_NAME, "skills"),
        recursive: false,
      }),
      skillsRoot({
        origin: "user",
        path: path.join(home, AGENTS_DIR_NAME, "skills"),
        recursive: false,
      }),
      ...(args.cwd === null
        ? []
        : [
            skillsRoot({
              origin: "project",
              path: path.join(args.cwd, GEMINI_DIR_NAME, "skills"),
              recursive: false,
            }),
            skillsRoot({
              origin: "project",
              path: path.join(args.cwd, AGENTS_DIR_NAME, "skills"),
              recursive: false,
            }),
          ]),
    ],
  };
};
