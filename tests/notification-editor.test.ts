import assert from "node:assert/strict";
import test from "node:test";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import { notificationField, refreshNotifications } from "../src/notification-editor";

class TestWidget extends WidgetType {
  toDOM(): HTMLElement { return document.createElement("div"); }
}
const setPath = StateEffect.define<string>();
const pathField = StateField.define({
  create: () => "Daily/Today.md",
  update: (path: string, transaction) => transaction.effects.find((effect) => effect.is(setPath))?.value ?? path,
});

test("footer remains at the end during typing, deletion and undo, before Influx", () => {
  const widget = new TestWidget();
  const field = notificationField((state) => state.field(pathField), () => widget);
  let state = EditorState.create({ doc: "Daily note", extensions: [pathField, field] });
  for (const insert of ["\nLast line", " more text", "\n"]) {
    const end = state.doc.length;
    state = state.update({ changes: { from: end, insert } }).state;
    const decoration = state.field(field).decorations.iter();
    assert.equal(decoration.from, state.doc.length);
    assert.equal(decoration.value?.spec.block, true);
    assert.ok(decoration.value!.spec.side > 0 && decoration.value!.spec.side < 1,
      "positive affinity avoids an empty editor line before Influx");
    assert.equal(decoration.value?.spec.widget, widget);
    const influx = Decoration.widget({ widget: new TestWidget(), side: 1, block: true });
    const together = Decoration.set([influx.range(state.doc.length), decoration.value!.range(state.doc.length)], true);
    assert.equal(together.iter().value?.spec.widget, widget);
  }
  const change = state.update({ changes: { from: 0, to: state.doc.length, insert: "" } });
  const inverse = change.changes.invert(state.doc);
  state = change.state;
  assert.equal(state.field(field).decorations.iter().from, 0);
  state = state.update({ changes: inverse }).state;
  assert.equal(state.field(field).decorations.iter().from, state.doc.length);
});

test("file switches and dismissal remove decorations without changing document text", () => {
  let visible = true;
  const widget = new TestWidget();
  const field = notificationField((state) => state.field(pathField),
    (path) => visible && path === "Daily/Today.md" ? widget : null);
  let state = EditorState.create({ doc: "# Today", extensions: [pathField, field] });
  assert.equal(state.field(field).decorations.size, 1);
  const original = state.field(field);
  state = state.update({ selection: { anchor: 2 } }).state;
  assert.equal(state.field(field), original, "moving the cursor does not rebuild the footer");
  state = state.update({ effects: setPath.of("Other.md") }).state;
  assert.equal(state.field(field).decorations.size, 0);
  state = state.update({ effects: setPath.of("Daily/Today.md") }).state;
  assert.equal(state.field(field).decorations.size, 1);
  visible = false;
  state = state.update({ effects: refreshNotifications.of(null) }).state;
  assert.equal(state.field(field).decorations.size, 0);
  assert.equal(state.doc.toString(), "# Today");
});
