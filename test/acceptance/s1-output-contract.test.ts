import { vi } from "vitest";
import { StandardOutput } from "@replicas/cli";
import { OutputContract } from "../contracts/output.contract";
import { RecordingOutput } from "../fakes/recording-output";

OutputContract.register({
  name: "RecordingOutput",
  make: () => {
    const output = new RecordingOutput();
    return { output, written: () => output.written() };
  },
});

OutputContract.register({
  name: "StandardOutput",
  make: () => {
    const chunks: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
    return { output: new StandardOutput(), written: () => chunks.join("") };
  },
});
