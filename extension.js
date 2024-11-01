const vscode = require('vscode');
const VGSASM_MODE = { scheme: 'file', language: 'vgsasm' };

function getStructMemberList(name, document) {
    return new Promise((resolve) => {
        const arrayBegin = name.indexOf('[');
        const arrayEnd = name.indexOf(']');
        if (-1 != arrayBegin && -1 != arrayEnd && arrayBegin < arrayEnd) {
            const l = name.substr(0, arrayBegin);
            const r = name.substr(arrayEnd + 1);
            name = l + r;
        }
        if (!name.endsWith('.')) {
            resolve();
            return;
        }
        const token = name.split(/[ .,()]/);
        if (token.length < 2) {
            resolve();
            return;
        }
        name = token[token.length - 2];
        const regex = new RegExp('struct\\s+' + name, 'i');
        let source = document.getText();
        getMemberListR({ type: "struct", regex: regex, name: name }, source, document, [], (list) => {
            if (list) {
                resolve(list);
            } else {
                getEnumMemberList(name, document, resolve);
            }
        });
    });
}

function getEnumMemberList(name, document, resolve) {
    const regex = new RegExp('enum\\s+' + name, 'i');
    let source = document.getText();
    getMemberListR({ type: "enum", regex: regex, name: name }, source, document, [], resolve);
}

function getMemberListR(config, source, document, documentList, resolve) {
    for (var i = 0; i < documentList.length; i++) {
        if (documentList[i] == document.uri.path) {
            resolve();
            return;
        }
    }
    documentList.push(document.uri.path);
    const structPosition = source.search(config.regex);
    if (-1 == structPosition) {
        const uriEndPos = document.uri.path.lastIndexOf('/');
        if (-1 == uriEndPos) {
            resolve();
            return;
        }
        const basePath = document.uri.path.substr(0, uriEndPos + 1);
        const lines = source.split('\n');
        var count = 0;
        for (var i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('#include')) {
                const tokens = lines[i].split(/[ \t]/);
                for (var j = 0; j < tokens.length; j++) {
                    if (tokens[j].startsWith('"') && tokens[j].endsWith('"')) {
                        count++;
                        const uri = document.uri.with({ path: basePath + tokens[j].substr(1, tokens[j].length - 2) });
                        vscode.workspace.openTextDocument(uri).then((includeDocument) => {
                            const includeSource = includeDocument.getText();
                            return getMemberListR(config, includeSource, includeDocument, documentList, resolve);
                        });
                    }
                }
            }
        }
        if (0 == count) {
            resolve();
        }
        return;
    }
    const beginPosition = source.indexOf('{', structPosition);
    if (-1 == beginPosition) {
        resolve();
        return;
    }
    const endPosition = source.indexOf('}', beginPosition);
    if (-1 == endPosition) {
        resolve();
        return;
    }
    const structDefinition = source.substr(beginPosition, endPosition - beginPosition + 1);
    const lines = structDefinition.split('\n');
    const list = [];
    for (var i = 1; i < lines.length - 1; i++) {
        var line = lines[i].trim();
        var detail = undefined;
        var commentPos = line.indexOf(';');
        if (-1 != commentPos) {
            detail = line.substr(commentPos + 1).trim();
        } else {
            commentPos = line.indexOf('//');
            if (-1 != commentPos) {
                detail = line.substr(commentPos + 2).trim();
            }
        }
        if (-1 != commentPos) {
            line = line.substr(0, commentPos);
        }
        const token = line.split(/[ \t]/);
        if (3 <= token.length && config.type == "struct") {
            list.push({ label: token[0], kind: vscode.CompletionItemKind.Field, detail: detail });
        } else if (1 <= token.length && config.type == "enum") {
            list.push({ label: token[0], kind: vscode.CompletionItemKind.Field, detail: detail });
        }
    }
    return resolve(new vscode.CompletionList(list, false));
}

function getStructMemberLocation(name, document) {
    return new Promise((resolve, reject) => {
        if (name.startsWith('"') && name.endsWith('"')) {
            name = name.substr(1, name.length - 2);
            const uriEndPos = document.uri.path.lastIndexOf('/');
            if (-1 == uriEndPos) {
                reject('No word definition.');
                return;
            }
            const path = document.uri.path.substr(0, uriEndPos + 1) + name;
            const uri = document.uri.with({ path: path });
            vscode.workspace.openTextDocument(uri).then((doc) => {
                resolve(new vscode.Location(doc.uri, new vscode.Position(0, 0)));
            }, () => {
                reject("File not found");
            });

        } else {
            const token = name.split(/[ .,()]/);
            name = token[0];
            const field = token.length < 2 ? undefined : token[1];
            const regex = new RegExp('struct\\s+' + name, 'i');
            let source = document.getText();
            getMemberLocationR({ type: "struct", regex: regex, name: name, field: field }, source, document, [], (loc) => {
                if (loc) {
                    resolve(loc);
                } else {
                    getEnumMemberLocation(name, field, document, (loc) => {
                        if (loc) {
                            resolve(loc);
                        } else {
                            getMacroLocation(name, document, (loc) => {
                                if (loc) {
                                    resolve(loc);
                                } else {
                                    reject();
                                }
                            });
                        }
                    });
                }
            });
        }
    });
}

function getEnumMemberLocation(name, field, document, resolve) {
    const regex = new RegExp('enum\\s+' + name, 'i');
    let source = document.getText();
    getMemberLocationR({ type: "enum", regex: regex, name: name, field: field }, source, document, [], (loc) => {
        if (loc) {
            resolve(loc);
        } else {
            resolve();;
        }
    });
}

function getMacroLocation(name, document, resolve) {
    const regex = new RegExp('macro\\s+' + name, 'i');
    let source = document.getText();
    getMemberLocationR({ type: "macro", regex: regex, name: name, field: undefined }, source, document, [], (loc) => {
        if (loc) {
            resolve(loc);
        } else {
            resolve();;
        }
    });
}

function getMemberLocationR(config, source, document, documentList, resolve) {
    for (var i = 0; i < documentList.length; i++) {
        if (documentList[i] == document.uri.path) {
            resolve();
            return;
        }
    }
    documentList.push(document.uri.path);
    const structPosition = source.search(config.regex);
    if (-1 == structPosition) {
        const uriEndPos = document.uri.path.lastIndexOf('/');
        if (-1 == uriEndPos) {
            resolve();
            return;
        }
        const basePath = document.uri.path.substr(0, uriEndPos + 1);
        const lines = source.split('\n');
        var count = 0;
        for (var i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('#include')) {
                const tokens = lines[i].split(/[ \t]/);
                for (var j = 0; j < tokens.length; j++) {
                    if (tokens[j].startsWith('"') && tokens[j].endsWith('"')) {
                        count++;
                        const uri = document.uri.with({ path: basePath + tokens[j].substr(1, tokens[j].length - 2) });
                        vscode.workspace.openTextDocument(uri).then((includeDocument) => {
                            const includeSource = includeDocument.getText();
                            return getMemberLocationR(config, includeSource, includeDocument, documentList, resolve);
                        });
                    }
                }
            }
        }
        if (0 == count) {
            resolve();
        }
        return;
    }
    const structLine = source.substr(0, structPosition).split('\n').length - 1;
    if (!config.field) {
        resolve(new vscode.Location(document.uri, new vscode.Position(structLine, 0)));
        return;
    }
    const beginPosition = source.indexOf('{', structPosition);
    if (-1 == beginPosition) {
        resolve(new vscode.Location(document.uri, new vscode.Position(structLine, 0)));
        return;
    }
    const endPosition = source.indexOf('}', beginPosition);
    if (-1 == endPosition) {
        resolve(new vscode.Location(document.uri, new vscode.Position(structLine, 0)));
        return;
    }
    const structDefinition = source.substr(structPosition, endPosition - structPosition + 1);
    const fieldPosition = structDefinition.indexOf(config.field);
    if (-1 == fieldPosition) {
        resolve(new vscode.Location(document.uri, new vscode.Position(structLine, 0)));
    } else {
        const fieldLine = structDefinition.substr(0, fieldPosition).split('\n').length - 1;
        resolve(new vscode.Location(document.uri, new vscode.Position(structLine + fieldLine, 4)));
    }
}

class VGSMethodCompletionItemProvider {
    provideCompletionItems(document, position, token) {
        const structName = document.lineAt(position).text.substr(0, position.character);
        return getStructMemberList(structName, document);
    }
}

class VGSDefinitionProvider {
    provideDefinition(document, position, token) {
        const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z0-9_\\\[\\\]\\.\\"\\/]+/);
        if (!wordRange) return Promise.reject('No word here.');
        var currentWord = document.lineAt(position.line).text.slice(wordRange.start.character, wordRange.end.character);
        const arrayBegin = currentWord.indexOf('[');
        const arrayEnd = currentWord.indexOf(']');
        if (-1 != arrayBegin && -1 != arrayEnd && arrayBegin < arrayEnd) {
            const l = currentWord.substr(0, arrayBegin);
            const r = currentWord.substr(arrayEnd + 1);
            currentWord = l + r;
        }
        console.log(currentWord);
        return getStructMemberLocation(currentWord, document);
    }
}

function getMacroR(config, source, document, documentList, resolve, reject) {
    for (var i = 0; i < documentList.length; i++) {
        if (documentList[i] == document.uri.path) {
            reject();
            return;
        }
    }
    documentList.push(document.uri.path);
    const macroPosition = source.search(config.regex);
    if (-1 == macroPosition) {
        const uriEndPos = document.uri.path.lastIndexOf('/');
        if (-1 == uriEndPos) {
            reject();
            return;
        }
        const basePath = document.uri.path.substr(0, uriEndPos + 1);
        const lines = source.split('\n');
        var count = 0;
        for (var i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('#include')) {
                const tokens = lines[i].split(/[ \t]/);
                for (var j = 0; j < tokens.length; j++) {
                    if (tokens[j].startsWith('"') && tokens[j].endsWith('"')) {
                        count++;
                        const uri = document.uri.with({ path: basePath + tokens[j].substr(1, tokens[j].length - 2) });
                        vscode.workspace.openTextDocument(uri).then((includeDocument) => {
                            const includeSource = includeDocument.getText();
                            getMacroR(config, includeSource, includeDocument, documentList, resolve, reject);
                        });
                    }
                }
            }
        }
        if (0 == count) {
            reject();
        }
        return;
    }
    const macroLine = source.substr(0, macroPosition).split('\n').length - 1;
    const macroLineText = document.lineAt(macroLine).text.trim();
    const bracketBegin = macroLineText.indexOf('(');
    const bracketEnd = macroLineText.indexOf(')');
    if (bracketBegin == -1 || bracketEnd == -1 || bracketEnd < bracketBegin) {
        reject();
        return;
    }
    const paramTexts = macroLineText.substr(bracketBegin + 1, bracketEnd - bracketBegin - 1).split(',');
    const params = [];
    for (var i = 0; i < paramTexts.length; i++) {
        params.push(new vscode.ParameterInformation(paramTexts[i], "")); // todo: argument help
    }
    var label = config.name + macroLineText.substr(bracketBegin, bracketEnd - bracketBegin + 1);
    const signatureHelp = new vscode.SignatureHelp();
    signatureHelp.activeParameter = 0;
    signatureHelp.activeSignature = 0;
    signatureHelp.signatures = [
        new vscode.SignatureInformation(label, "") // todo: function help
    ];
    signatureHelp.signatures[0].parameters = params;
    signatureHelp.signatures[0].activeParameter = config.activeParam;
    resolve(signatureHelp);
}

class VGSSignatureHelpProvider {
    provideSignatureHelp(document, position, token) {
        return new Promise((resolve, reject) => {
            const line = document.lineAt(position.line);
            const lineText = line.text.substr(0, position.character).trim();
            const bracketBegin = lineText.indexOf('(');
            if (-1 == bracketBegin) {
                reject('no open parenthesis before cursor');
                return;
            }
            if (lineText.substr(bracketBegin - 1, 1) == ' ') {
                reject('not macro call');
                return;
            }
            if (-1 != lineText.indexOf(')')) {
                reject('close by bracket end');
                return;
            }
            const activeParam = lineText.split(',').length - 1;
            const name = lineText.substr(0, bracketBegin);
            const regex = new RegExp('macro\\s+' + name, 'i');
            const source = document.getText();
            getMacroR({ name: name, activeParam: activeParam, regex: regex }, source, document, [], resolve, reject);
        });
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
