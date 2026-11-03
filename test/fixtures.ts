/** A neutral Phase 1 intake for tests: an adult alone, no time limit, nothing avoided. */
import { parseIntake } from "../src/core/intake";
import { initialIS } from "../src/core/state";
import solo from "../profiles/solo.json";

export const freshIS = () => initialIS(parseIntake(solo));
