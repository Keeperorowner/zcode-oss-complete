/**
 * Swift interop 层。
 *
 * 补齐原因：开源版这里是两个 TODO 桩（`isSwiftAvailable` 恒 false、
 * `detectSwiftVersion` 恒 null），导致 macOS 侧依赖 Swift 工具链的能力探测
 * 全部误判为「没有 Swift」。这里做真实的 `swift --version` 探测。
 */
import { spawn } from "node:child_process";

const SWIFT_VERSION_TIMEOUT_MS = 5_000;

export const isSwiftAvailable = (): boolean => {
  return process.platform === "darwin";
};

export const detectSwiftVersion = async (): Promise<string | null> => {
  if (!isSwiftAvailable()) {
    return null;
  }
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let child;
    try {
      child = spawn("swift", ["--version"], {
        stdio: ["ignore", "pipe", "pipe"],
        // Swift 工具链在 Xcode CLT 路径下，继承 PATH 即可；显式 shell:false 避免转义问题。
        shell: false,
      });
    } catch {
      finish(null);
      return;
    }

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // 进程可能已退出。
      }
      finish(null);
    }, SWIFT_VERSION_TIMEOUT_MS);

    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    // stderr 也带版本串（Apple Swift version ... 在部分工具链里走 stderr）。
    child.stderr?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.on("error", () => {
      clearTimeout(timer);
      finish(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        finish(null);
        return;
      }
      finish(parseSwiftVersion(stdout));
    });
  });
};

function parseSwiftVersion(output: string): string | null {
  // 形如 "Apple Swift version 6.0.3 (swiftlang-6.0.3.1.10 clang-1600.0.26.6)" 或
  // "Swift version 6.0.3 (swift-6.0.3-RELEASE)"。
  const match = /Swift version\s+([0-9]+(?:\.[0-9]+){0,2})/i.exec(output);
  return match?.[1] ?? null;
}
