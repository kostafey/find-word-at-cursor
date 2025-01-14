import { Disposable, Position, Range, Selection, TextDocument, TextEditorRevealType, ThemeColor, window } from 'vscode';
import * as vscode from 'vscode';

// We will decorate found matches with this decoration type, which is just the default theme
// highlight behind the word.
const decorationType = window.createTextEditorDecorationType({
    backgroundColor: new ThemeColor('editor.wordHighlightBackground'),
});

// We export eventRegistrations so that we can remove the listeners in `extension.ts` when
// the extension is deactivated
export const eventRegistrations: Disposable[] = [];

export function next() {
    _seek();
}

export function previous() {
    _seek(true);
}

// When the user moves the mouse, set decorations to an empty array, effectively removing all
// of our decorations.
eventRegistrations.push(
    window.onDidChangeTextEditorSelection(() => {
        if (window.activeTextEditor) {
            window.activeTextEditor.setDecorations(decorationType, []);
        }
    }),
);

function _seek(backward = false) {
    const { activeTextEditor } = window;

    if (!activeTextEditor) {
        return;
    }

    const { document, selection } = activeTextEditor;
    const { active, end, start } = selection;

    if (!selection.isSingleLine) {
        return;
    }

    // https://github.com/Microsoft/vscode/pull/36682
    // If start with a collapsed selection,
    // `wholeWords: true; caseSensitive: true`
    //
    const isStrictSearch = selection.isEmpty;

    const needleRange = isStrictSearch ? document.getWordRangeAtPosition(end) : selection;
    if (needleRange === undefined) {
        return;
    }
    const needleCursorOffset = document.offsetAt(active) - document.offsetAt(needleRange.start);
    const needle = document.getText(needleRange);

    const foundPosition = searchBySlidingRange(document, needleRange, backward, isStrictSearch);
    const foundRange = document.getWordRangeAtPosition(foundPosition);

    const findWordAtCursorConfig = vscode.workspace.getConfiguration('findWordAtCursor');

    if (findWordAtCursorConfig.showMessageIfNotFound && 
        foundRange !== undefined && 
        needleRange.isEqual(foundRange)) {
        window.showInformationMessage('No more matches.');
        return;
    }

    const cursorPos = addOffsetToPos(foundPosition, needleCursorOffset, document);
    const wordSelection = isStrictSearch
        ? new Selection(cursorPos, cursorPos)
        : new Selection(foundPosition, addOffsetToPos(foundPosition, needle.length, document));
    activeTextEditor.selection = wordSelection;

    // Scroll the view to the selection
    activeTextEditor.revealRange(wordSelection, TextEditorRevealType.InCenterIfOutsideViewport);

    // If `wholeWords == false`, we want to highlight the match that was navigated to.
    if (!isStrictSearch) {
        if (foundRange) {
            setTimeout(() => {
                activeTextEditor.setDecorations(decorationType, [foundRange]);
            }, 10);
        }
    }
}

function searchBySlidingRange(doc: TextDocument, wordRange: Range, seekBack: boolean, isStrictSearch: boolean): Position {
    let word = doc.getText(wordRange);
    const { start, end } = wordRange;
    const startOffset = doc.offsetAt(start);
    const endOffset = doc.offsetAt(end);
    const wholeLength = doc.getText().length;

    let stepSize = Math.min(1000, Math.max(100, wholeLength / 10));

    let range = seekBack
        ? new Range(doc.positionAt(startOffset - stepSize), start)
        : new Range(end, doc.positionAt(endOffset + stepSize));

    word = isStrictSearch ? word : word.toLowerCase();
    while (true) {
        let rangeText = doc.getText(range);
        rangeText = isStrictSearch ? rangeText : rangeText.toLowerCase();

        let index = seekBack ? rangeText.lastIndexOf(word) : rangeText.indexOf(word);
        if (index !== -1) {
            let candidate = addOffsetToPos(range.start, index, doc);
            if (isStrictSearch) {
                let foundWord = doc.getText(doc.getWordRangeAtPosition(candidate));
                if (foundWord === word) {
                    return candidate;
                } else {
                    seekBack
                        ? range = range.with({ end: candidate })
                        : range = range.with(addOffsetToPos(range.start, index + foundWord.length, doc));
                }
            } else {
                return candidate;
            }
        } else {
            // Reach the SOF or EOF
            if (seekBack && doc.offsetAt(range.start) === 0) {
                range = new Range(doc.positionAt(Math.max(wholeLength - stepSize, startOffset)), doc.positionAt(wholeLength - 1));
            } else if (!seekBack && doc.offsetAt(range.end) === wholeLength) {
                range = new Range(new Position(0, 0), doc.positionAt(Math.min(stepSize, endOffset)));
            } else {
                // Slide searching range
                seekBack
                    ? range = range.with(addOffsetToPos(range.start, -stepSize, doc), addOffsetToPos(range.end, -stepSize + word.length, doc))
                    : range = range.with(addOffsetToPos(range.end, -word.length, doc), addOffsetToPos(range.end, stepSize, doc));
            }
        }
    }
}

function addOffsetToPos(pos: Position, offset: number, doc: TextDocument): Position {
    return doc.positionAt(doc.offsetAt(pos) + offset);
}
