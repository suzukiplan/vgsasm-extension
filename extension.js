const vscode = require('vscode');
const VGSASM_MODE = { scheme: 'file', language: 'vgsasm' };

async function search(regex, document, documentList) {
    for (var i = 0; i < documentList.length; i++) {
        if (documentList[i] == document.uri.path) {
            return undefined; // 既に探索済み
        }
    }
    documentList.push(document.uri.path);
    const pos = document.getText().search(regex);
    if (-1 == pos) {
        // 見つからなかったので include しているファイルを探索
        const uriEndPos = document.uri.path.lastIndexOf('/');
        const basePath = document.uri.path.substr(0, uriEndPos + 1);
        const lines = document.getText().split('\n');
        for (var i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('#include')) {
                const tokens = lines[i].split(/[ \t]/);
                for (var j = 0; j < tokens.length; j++) {
                    if (tokens[j].startsWith('"') && tokens[j].endsWith('"')) {
                        const uri = document.uri.with({ path: basePath + tokens[j].substr(1, tokens[j].length - 2) });
                        const includeDocument = await vscode.workspace.openTextDocument(uri);
                        if (includeDocument) {
                            const result = await search(regex, includeDocument, documentList);
                            if (result) {
                                return result;
                            }
                        }
                    }
                }
            }
        }
        return undefined; // include を含めて見つからなかった
    } else {
        return {
            doc: document,
            pos: pos
        }
    }
}

function getScopeLines(searchResult, minimumToken) {
    const source = searchResult.doc.getText();
    const begin = source.indexOf('{', searchResult.pos);
    if (-1 == begin) {
        return undefined;
    }
    const end = source.indexOf('}', begin);
    const scopeLines = source.substr(begin + 1, end - begin - 1).split('\n');
    var result = [];
    for (var i = 0; i < scopeLines.length; i++) {
        var line = scopeLines[i].trim();
        var comment = undefined;
        var commentPos = line.indexOf(';');
        if (-1 == commentPos) {
            commentPos = line.indexOf('//');
            if (-1 != commentPos) {
                comment = line.substr(commentPos + 2).trim();
                line = line.substr(0, commentPos - 1).trim();
            }
        } else {
            comment = line.substr(commentPos + 1).trim();
            line = line.substr(0, commentPos - 1).trim();
        }
        const tokens = line.split(/[ \t]/);
        if (minimumToken <= tokens.length) {
            result.push({ tokens: tokens, comment: comment });
        }
    }
    return result;
}

function getFieldLine(source, pos, field) {
    if (!field) {
        return -1;
    }
    const scopeEnd = source.indexOf('}', pos);
    if (-1 != scopeEnd) {
        const defSource = source.substr(pos, scopeEnd - pos);
        const fieldPos = defSource.indexOf(field);
        if (-1 != fieldPos) {
            return defSource.substr(0, fieldPos).split('\n').length - 1;
        }
    }
    return -1;
}

async function getStructMemberList(name, document) {
    const arrayBegin = name.indexOf('[');
    const arrayEnd = name.indexOf(']');
    if (-1 != arrayBegin && -1 != arrayEnd && arrayBegin < arrayEnd) {
        const l = name.substr(0, arrayBegin);
        const r = name.substr(arrayEnd + 1);
        name = l + r;
    }
    if (!name.endsWith('.')) {
        return undefined;
    }
    const token = name.split(/[ .,()]/);
    if (token.length < 2) {
        return undefined;
    }
    name = token[token.length - 2];
    const regex = new RegExp('struct\\s+' + name, 'i');
    const searchResult = await search(regex, document, []);
    if (!searchResult) {
        return undefined;
    }
    const scope = getScopeLines(searchResult, 3);
    var list = [];
    for (var i = 0; i < scope.length; i++) {
        list.push({ label: scope[i].tokens[0], kind: vscode.CompletionItemKind.Field, detail: scope[i].comment });
    }
    return new vscode.CompletionList(list, false);
}

async function getEnumMemberList(name, document) {
    if (!name.endsWith('.')) {
        return undefined;
    }
    name = name.substr(0, name.length - 1).trim();
    console.log("search enum " + name);
    const regex = new RegExp('enum\\s+' + name, 'i');
    const searchResult = await search(regex, document, []);
    if (!searchResult) {
        return undefined;
    }
    const scope = getScopeLines(searchResult, 1);
    var list = [];
    for (var i = 0; i < scope.length; i++) {
        list.push({ label: scope[i].tokens[0], kind: vscode.CompletionItemKind.Field, detail: scope[i].comment });
    }
    return new vscode.CompletionList(list, false);
}

async function getLocation(regex, field, document) {
    const searchResult = await search(regex, document, []);
    if (!searchResult) {
        return undefined;
    }
    const source = searchResult.doc.getText();
    const structLine = source.substr(0, searchResult.pos).split('\n').length - 1;
    const fieldLine = getFieldLine(source, searchResult.pos, field);
    if (-1 == fieldLine) {
        return new vscode.Location(searchResult.doc.uri, new vscode.Position(structLine, 0));
    } else {
        return new vscode.Location(searchResult.doc.uri, new vscode.Position(structLine + fieldLine, 0));
    }
}

async function getStructMemberLocation(name, field, document) {
    const regex = new RegExp('struct\\s+' + name, 'i');
    return await getLocation(regex, field, document);
}

async function getEnumMemberLocation(name, field, document) {
    const regex = new RegExp('enum\\s+' + name, 'i');
    return await getLocation(regex, field, document);
}

async function getMacroLocation(name, document) {
    const regex = new RegExp('macro\\s+' + name, 'i');
    return await getLocation(regex, undefined, document);
}

function isLabelLine(lineText) {
    if (lineText.startsWith('.')) {
        return true;
    }
    if (-1 != lineText.search(/^\\w+:/)) {
        return true;
    }
    return false;
}

function searchAtLabel(name, document, baseLine) {
    for (var startLine = baseLine - 1; 0 <= startLine; startLine--) {
        const line = document.lineAt(startLine).text;
        if (isLabelLine(line)) {
            break;
        } else if (line.startsWith(name)) {
            return new vscode.Location(document.uri, new vscode.Position(startLine, 0));
        }
    }
    for (var endLine = baseLine + 1; endLine < document.lineCount; endLine++) {
        const line = document.lineAt(endLine).text;
        if (isLabelLine(line)) {
            break;
        } else if (line.startsWith(name)) {
            return new vscode.Location(document.uri, new vscode.Position(endLine, 0));
        }
    }
    return undefined;
}

async function getLabelLocation(name, document, baseLine) {
    if (name.startsWith('@')) {
        return searchAtLabel(name, document, baseLine);
    } else if (-1 != name.indexOf('@')) {
        var token = name.split('@');
        var nl = await search(new RegExp('\\.' + token[1], 'i'), document, []);
        if (!nl) {
            nl = await search(new RegExp(token[1] + ':', 'i'), document, []);
            if (!nl) {
                return undefined
            }
        }
        return searchAtLabel('@' + token[0], nl.doc, nl.doc.getText().substr(0, nl.pos).split('\n').length);
    } else {
        const dotRegex = new RegExp("\\." + name, 'i');
        const dotLabel = await getLocation(dotRegex, undefined, document);
        if (dotLabel) { return dotLabel; }
        const colRegex = new RegExp(name + ':', 'i');
        const colLabel = await getLocation(colRegex, undefined, document);
        if (colLabel) { return colLabel; }
        return undefined;
    }
}

async function getFileLocation(document, name) {
    const uriEndPos = document.uri.path.lastIndexOf('/');
    const basePath = document.uri.path.substr(0, uriEndPos + 1);
    const uri = document.uri.with({ path: basePath + name });
    const doc = await vscode.workspace.openTextDocument(uri);
    if (doc) {
        return new vscode.Location(doc.uri, new vscode.Position(0, 0));
    }
}

class VGSMethodCompletionItemProvider {
    async provideCompletionItems(document, position, token) {
        const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z0-9_\\\[\\\]\\.\\"\\/]+/);
        if (!wordRange) return;
        var name = document.lineAt(position.line).text.slice(wordRange.start.character, wordRange.end.character);
        const structList = await getStructMemberList(name, document);
        if (structList) {
            return structList;
        }
        const enumList = await getEnumMemberList(name, document);
        if (enumList) {
            return enumList;
        }
    }
}

class VGSDefinitionProvider {
    async provideDefinition(document, position, token) {
        const wordRange = document.getWordRangeAtPosition(position, /[@a-zA-Z0-9_\\\[\\\]\\.\\"\\/]+/);
        if (!wordRange) return;
        var currentWord = document.lineAt(position.line).text.slice(wordRange.start.character, wordRange.end.character);
        console.log(currentWord);
        const dqBegin = currentWord.indexOf('"');
        if (-1 != dqBegin) {
            const dqEnd = currentWord.indexOf('"', dqBegin + 1);
            const path = currentWord.substr(dqBegin + 1, dqEnd - dqBegin - 1);
            return await getFileLocation(document, path);
        }
        const arrayBegin = currentWord.indexOf('[');
        const arrayEnd = currentWord.indexOf(']');
        if (-1 != arrayBegin && -1 != arrayEnd && arrayBegin < arrayEnd) {
            const l = currentWord.substr(0, arrayBegin);
            const r = currentWord.substr(arrayEnd + 1);
            currentWord = l + r;
        }
        const dot = currentWord.indexOf('.');
        var field = undefined;
        if (-1 != dot) {
            field = currentWord.substr(dot + 1);
            currentWord = currentWord.substr(0, dot);
        }
        const sloc = await getStructMemberLocation(currentWord, field, document);
        if (sloc) { return sloc; }
        const eloc = await getEnumMemberLocation(currentWord, field, document);
        if (eloc) { return eloc; }
        const mloc = await getMacroLocation(currentWord, document);
        if (mloc) { return mloc; }
        const lloc = await getLabelLocation(currentWord, document, position.line);
        if (lloc) { return lloc; }
        return undefined;
    }
}

class VGSSignatureHelpProvider {
    async provideSignatureHelp(document, position, token) {
        const line = document.lineAt(position.line);
        const lineText = line.text.substr(0, position.character).trim();
        var bracketBegin = lineText.indexOf('(');
        if (-1 == bracketBegin) {
            return;
        }
        if (lineText.substr(bracketBegin - 1, 1) == ' ') {
            return;
        }
        if (-1 != lineText.indexOf(')')) {
            return;
        }
        const activeParam = lineText.split(',').length - 1;
        const name = lineText.substr(0, bracketBegin);
        const regex = new RegExp('macro\\s+' + name, 'i');
        console.log("search macro " + name);
        const searchResult = await search(regex, document, []);
        if (!searchResult) {
            return;
        }
        const source = searchResult.doc.getText();
        const macroPosition = searchResult.pos;
        const macroLine = source.substr(0, macroPosition).split('\n').length - 1;
        const macroLineText = searchResult.doc.lineAt(macroLine).text.trim();
        bracketBegin = macroLineText.indexOf('(');
        const bracketEnd = macroLineText.indexOf(')');
        if (bracketBegin == -1 || bracketEnd == -1 || bracketEnd < bracketBegin) {
            return;
        }
        const paramTexts = macroLineText.substr(bracketBegin + 1, bracketEnd - bracketBegin - 1).split(',');
        const params = [];
        for (var i = 0; i < paramTexts.length; i++) {
            params.push(new vscode.ParameterInformation(paramTexts[i], ""));
        }
        var label = name + macroLineText.substr(bracketBegin, bracketEnd - bracketBegin + 1);
        const signatureHelp = new vscode.SignatureHelp();
        signatureHelp.activeParameter = 0;
        signatureHelp.activeSignature = 0;
        signatureHelp.signatures = [
            new vscode.SignatureInformation(label, "")
        ];
        signatureHelp.signatures[0].parameters = params;
        signatureHelp.signatures[0].activeParameter = activeParam;
        return signatureHelp;
    }
}

function activate(context) {
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(VGSASM_MODE, new VGSMethodCompletionItemProvider(), '.'));
    context.subscriptions.push(vscode.languages.registerDefinitionProvider(VGSASM_MODE, new VGSDefinitionProvider()));
    context.subscriptions.push(vscode.languages.registerSignatureHelpProvider(VGSASM_MODE, new VGSSignatureHelpProvider(), '(', ','));
}

function deactivate() {
    return undefined;
}

module.exports = { activate, deactivate };
