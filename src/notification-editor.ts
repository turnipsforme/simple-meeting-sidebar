import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";

export const refreshNotifications = StateEffect.define<null>();

/** Positive affinity avoids a blank editor line; 0.5 sorts before Influx's side: 1. */
export function notificationField(
  getPath: (state: EditorState) => string | undefined,
  getWidget: (path: string | undefined) => WidgetType | null,
): StateField<{ path: string | undefined; decorations: DecorationSet }> {
  const build = (state: EditorState) => {
    const path = getPath(state);
    const widget = getWidget(path);
    return {
      path,
      decorations: widget
        ? Decoration.set([Decoration.widget({ widget, block: true, side: 0.5 }).range(state.doc.length)])
        : Decoration.none,
    };
  };
  return StateField.define({
    create: build,
    update(value, transaction) {
      if (transaction.docChanged || getPath(transaction.state) !== value.path
        || transaction.effects.some((effect) => effect.is(refreshNotifications))) {
        return build(transaction.state);
      }
      return value;
    },
    provide: (field) => [
      EditorView.decorations.from(field, (value) => value.decorations),
      EditorView.editorAttributes.from(field, (value) => value.decorations.size
        ? { class: "wcm-has-notifications" } : {}),
    ],
  });
}
