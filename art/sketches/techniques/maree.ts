/** La v1 telle quelle (moteur réel). */
import days from "@sillage/shared/fixtures/days.json";
import { composeForDate, type DayInput } from "../../src/engine";
import { drawSceneToContext } from "../../src/engine/render-p5";
import { DATE, type Sketch } from "../day";

const sketch: Sketch = (ctx, S) => {
  drawSceneToContext(ctx, composeForDate(DATE, days as unknown as DayInput[]), S);
};
export default sketch;
