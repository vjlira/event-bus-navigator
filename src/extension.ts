import * as vscode from 'vscode';
import * as yaml from 'js-yaml';

const EVENT_FILE_GLOB = '**/config/event_bus_subscriptions.yml';

function classToUnderscorePath(klass: string): string {
  const parts = klass.split('::');
  const snake = parts.map((p) => p.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase());
  return snake.join('/');
}

function nearestClassName(document: vscode.TextDocument, pos: vscode.Position): string | undefined {
  for (let line = pos.line; line >= 0; line--) {
    const text = document.lineAt(line).text;
    const m = text.match(/^\s*class\s+([A-Za-z0-9_:]+)/);
    if (m) return m[1];
  }
  return undefined;
}

function computeEventName(document: vscode.TextDocument, pos: vscode.Position, kind: 'success' | 'workflow_success'): string | undefined {
  const klass = nearestClassName(document, pos);
  if (!klass) return undefined;
  const emitter = classToUnderscorePath(klass);
  return `bus_event.${emitter}.${kind}`;
}

async function findEventMatch(eventName: string): Promise<{ uri?: vscode.Uri; line: number; handlers: string[] }> {
  const files = await vscode.workspace.findFiles(EVENT_FILE_GLOB, '**/node_modules/**', 200);
  for (const uri of files) {
    const doc = await vscode.workspace.openTextDocument(uri);
    const text = doc.getText();
    const lines = text.split(/\r?\n/);
    for (let idx = 0; idx < lines.length; idx++) {
      const l = lines[idx];
      if (l.includes(eventName)) {
        const handlers: string[] = [];
        for (let j = idx + 1; j < Math.min(idx + 20, lines.length); j++) {
          const hl = lines[j];
          const m = hl.match(/handler:\s*([A-Za-z0-9_:]+)/);
          if (m) handlers.push(m[1]);
          if (/^\s*-\s*event_name:/.test(hl)) break;
        }
        return { uri, line: idx, handlers };
      }
    }
  }
  return { line: -1, handlers: [] };
}

async function findAllHandlers(eventName: string): Promise<Array<{ handler: string; uri?: vscode.Uri }>> {
  const files = await vscode.workspace.findFiles(EVENT_FILE_GLOB, '**/node_modules/**', 200);
  const results: Array<{ handler: string; uri?: vscode.Uri }> = [];
  for (const uri of files) {
    const doc = await vscode.workspace.openTextDocument(uri);
    const text = doc.getText();
    try {
      const data = yaml.load(text) as Array<any> | undefined;
      if (!Array.isArray(data)) continue;
      for (const entry of data) {
        if (entry && entry.event_name === eventName && entry.handler) {
          results.push({ handler: String(entry.handler) });
        }
      }
    } catch {
      // ignore invalid yaml
    }
  }
  // Try resolve URIs for handlers
  const resolved: Array<{ handler: string; uri?: vscode.Uri }> = [];
  for (const r of results) {
    const uri = await resolveHandlerUri(r.handler);
    resolved.push({ handler: r.handler, uri });
  }
  return resolved;
}

async function resolveHandlerUri(handler: string): Promise<vscode.Uri | undefined> {
  const rel = handler
    .split('::')
    .map((p) => p.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase())
    .join('/') + '.rb';
  const uris = await vscode.workspace.findFiles(`**/${rel}`, '**/node_modules/**', 10);
  return uris[0];
}

class BroadcastCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.CodeLens[]> {
    const lenses: vscode.CodeLens[] = [];
    const lines = document.getText().split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let kind: 'success' | 'workflow_success' | undefined;
      if (/\bbroadcast_success\b/.test(line)) kind = 'success';
      else if (/\bworkflow_event_success\b/.test(line)) kind = 'workflow_success';
      if (!kind) continue;
      const pos = new vscode.Position(i, 0);
      const range = new vscode.Range(pos, new vscode.Position(i, line.length));
      const eventName = computeEventName(document, pos, kind);
      if (!eventName) continue;
      lenses.push(
        new vscode.CodeLens(range, {
          title: `Open event config (${eventName})`,
          command: 'bukEventBus.openEventConfig',
          arguments: [document.uri, i, eventName],
        }),
      );
      lenses.push(
        new vscode.CodeLens(range, {
          title: `Open handlers`,
          command: 'bukEventBus.openHandlers',
          arguments: [eventName],
        }),
      );
    }
    return lenses;
  }
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ language: 'ruby' }, new BroadcastCodeLensProvider()),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('bukEventBus.openEventConfig', async (_uri: vscode.Uri, _line: number, eventName?: string) => {
      if (!eventName) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const pos = editor.selection.active;
        const inferred = computeEventName(editor.document, pos, /workflow_event_success/.test(editor.document.lineAt(pos.line).text) ? 'workflow_success' : 'success');
        eventName = inferred;
      }
      if (!eventName) return vscode.window.showInformationMessage('Event name not found.');
      const match = await findEventMatch(eventName);
      if (match.uri) {
        const doc = await vscode.workspace.openTextDocument(match.uri);
        const ed = await vscode.window.showTextDocument(doc, { preview: false });
        const target = new vscode.Position(Math.max(0, match.line), 0);
        ed.selection = new vscode.Selection(target, target);
        ed.revealRange(new vscode.Range(target, target), vscode.TextEditorRevealType.InCenter);
      } else {
        vscode.window.showInformationMessage(`Event config not found for ${eventName}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('bukEventBus.openHandlers', async (eventName?: string) => {
      if (!eventName) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const pos = editor.selection.active;
        const inferred = computeEventName(editor.document, pos, /workflow_event_success/.test(editor.document.lineAt(pos.line).text) ? 'workflow_success' : 'success');
        eventName = inferred;
      }
      if (!eventName) return vscode.window.showInformationMessage('Event name not found.');
      const handlers = await findAllHandlers(eventName);
      if (!handlers.length) return vscode.window.showInformationMessage(`No handlers found for ${eventName}`);
      const picks = handlers.map((h) => {
        const rel = h.uri ? vscode.workspace.asRelativePath(h.uri) : '';
        return { label: h.handler, description: rel };
      });
      const picked = await vscode.window.showQuickPick(picks, { placeHolder: `Handlers for ${eventName}` });
      if (!picked) return;
      const chosen = handlers.find((h) => h.handler === picked.label);
      if (!chosen) return;
      const uri = chosen.uri ?? (await resolveHandlerUri(chosen.handler));
      if (!uri) return vscode.window.showInformationMessage(`Handler file not found for ${chosen.handler}`);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
    }),
  );
}

export function deactivate() {}
