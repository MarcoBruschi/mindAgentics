import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

test('UI Redesign & Component Specification Verification', async (t) => {
  await t.test('Tokens: tailwind.config.js defines correct surface palette and single indigo accent', () => {
    const tailwindConfigPath = path.join(rootDir, 'packages/renderer/tailwind.config.js');
    const content = fs.readFileSync(tailwindConfigPath, 'utf8');

    assert.ok(content.includes('#0E0F12'), 'Should contain background #0E0F12');
    assert.ok(content.includes('#121418'), 'Should contain sidebar #121418');
    assert.ok(content.includes('#14161A'), 'Should contain surface primary #14161A');
    assert.ok(content.includes('#181B20'), 'Should contain surface secondary #181B20');
    assert.ok(content.includes('#23262C'), 'Should contain border #23262C');
    assert.ok(content.includes('#8B93FF'), 'Should contain accent #8B93FF');
    assert.ok(content.includes('#5FD3A0'), 'Should contain status #5FD3A0');
    assert.ok(content.includes('#E7E8EA'), 'Should contain text primary #E7E8EA');
    assert.ok(content.includes('#8A8F98'), 'Should contain text secondary #8A8F98');
  });

  await t.test('Knowledge Graph Modal: CreateGraphModal.tsx complies with 520x600 and zero tokens card', () => {
    const modalPath = path.join(rootDir, 'packages/renderer/src/components/modals/CreateGraphModal.tsx');
    const content = fs.readFileSync(modalPath, 'utf8');

    assert.ok(content.includes('max-w-[520px]'), 'Should constrain max width to 520px');
    assert.ok(content.includes('max-h-[600px]'), 'Should constrain max height to 600px');
    assert.ok(content.includes('Zero tokens'), 'Should include "Zero tokens" card title');
    assert.ok(content.includes('#8B93FF'), 'Should use indigo accent #8B93FF');
    assert.ok(content.includes('Gerar grafo'), 'Should include primary action "Gerar grafo"');
  });

  await t.test('Toolbars: CanvasToolbar.tsx & TextBlockNode.tsx implement 7 calibrated colors and capsule style', () => {
    const toolbarPath = path.join(rootDir, 'packages/renderer/src/components/toolbar/CanvasToolbar.tsx');
    const textNodePath = path.join(rootDir, 'packages/renderer/src/components/nodes/TextBlockNode.tsx');
    const toolbarContent = fs.readFileSync(toolbarPath, 'utf8');
    const textNodeContent = fs.readFileSync(textNodePath, 'utf8');

    assert.ok(toolbarContent.includes('#8B93FF'), 'CanvasToolbar uses indigo accent #8B93FF');
    assert.ok(toolbarContent.includes('#5FD3A0'), 'CanvasToolbar uses status green #5FD3A0');
    assert.ok(textNodeContent.includes('#8B93FF'), 'TextBlockNode uses indigo border/accent on edit');
    assert.ok(textNodeContent.includes('rounded-full'), 'TextBlockNode uses floating capsule styling');
  });

  await t.test('Canvas & Sidebar: Sidebar has 248px width, GridBackground has 24px dot grid', () => {
    const sidebarPath = path.join(rootDir, 'packages/renderer/src/components/sidebar/Sidebar.tsx');
    const gridPath = path.join(rootDir, 'packages/renderer/src/components/canvas/GridBackground.tsx');
    const canvasPath = path.join(rootDir, 'packages/renderer/src/components/canvas/InfiniteCanvas.tsx');

    const sidebarContent = fs.readFileSync(sidebarPath, 'utf8');
    const gridContent = fs.readFileSync(gridPath, 'utf8');
    const canvasContent = fs.readFileSync(canvasPath, 'utf8');

    assert.ok(sidebarContent.includes('w-[248px]'), 'Sidebar is fixed at 248px width');
    assert.ok(sidebarContent.includes('ESPAÇOS DE TRABALHO'), 'Sidebar has uppercase label ESPAÇOS DE TRABALHO');
    assert.ok(gridContent.includes('24 * offset.zoom'), 'GridBackground dot step is 24px');
    assert.ok(gridContent.includes('#23262C'), 'GridBackground uses #23262C for dots');
    assert.ok(canvasContent.includes('Canvas vazio — crie um terminal na barra acima para começar'), 'InfiniteCanvas includes empty state');
  });

  await t.test('New Terminal Modal: CreateAgentModal.tsx complies with 480x700, switches and clean layout', () => {
    const modalPath = path.join(rootDir, 'packages/renderer/src/components/modals/CreateAgentModal.tsx');
    const content = fs.readFileSync(modalPath, 'utf8');

    assert.ok(content.includes('max-w-[480px]'), 'Should constrain max width to 480px');
    assert.ok(content.includes('max-h-[700px]'), 'Should constrain max height to 700px');
    assert.ok(content.includes('role="switch"'), 'Switches have semantic role="switch"');
    assert.ok(content.includes('Criar terminal'), 'Primary button is "Criar terminal"');
  });

  await t.test('Agent Limits Popover: AgentLimitsModal.tsx has 380px width, 4px linear bars, and 22px percent', () => {
    const popoverPath = path.join(rootDir, 'packages/renderer/src/components/modals/AgentLimitsModal.tsx');
    const content = fs.readFileSync(popoverPath, 'utf8');

    assert.ok(content.includes('w-[380px]'), 'Popover width is 380px');
    assert.ok(content.includes('max-h-[700px]'), 'Popover max height is 700px');
    assert.ok(content.includes('text-[22px]'), 'Percentage is rendered in 22px typography');
    assert.ok(content.includes('h-1'), 'Linear bars are thin (4px / h-1)');
  });
});
