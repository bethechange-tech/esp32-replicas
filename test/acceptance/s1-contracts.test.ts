import { FileBoardFacts } from "@replicas/firmware";
import { BoardFactsSourceContract } from "../contracts/board-facts-source.contract";
import { FixedBoardFacts } from "../fakes/fixed-board-facts";
import { S1Fixtures } from "./support/s1-fixtures";

BoardFactsSourceContract.register({ name: "FileBoardFacts", make: () => ({ source: new FileBoardFacts(S1Fixtures.factsPath()), board: "small-screen" }) });
BoardFactsSourceContract.register({ name: "FixedBoardFacts", make: () => ({ source: new FixedBoardFacts({ chip: "esp32s3", flashBytes: 16 }), board: "small-screen" }) });
