import type { FlowAnswer, FlowRequest, GuestRadio } from "@replicas/core";

/** A radio that hands out the requests it was given and records every answer; it answers a data event as taken whole. */
export class FakeGuestRadio implements GuestRadio {
  readonly answers: FlowAnswer[] = [];
  requests: FlowRequest[] = [];
  attachWifi(): void {}
  takeFlowRequests(): readonly FlowRequest[] {
    const taken = this.requests;
    this.requests = [];
    return taken;
  }
  answer(answer: FlowAnswer): number {
    this.answers.push(answer);
    return answer.kind === "data" ? answer.bytes.length : 1;
  }
  takeNetworkFrames(): never[] {
    return [];
  }
}
