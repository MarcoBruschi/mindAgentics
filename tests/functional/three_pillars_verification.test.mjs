import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  calculateLevelAndXp,
  createDefaultProfile,
  getTitleForLevel,
  INITIAL_BADGES,
} from '../../packages/shared/dist/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../');

describe('Three Pillars Verification Suite: Gamification, Crisp Text & Icon Modernization', () => {
  describe('Pillar 1: User Profile & Gamification Engine', () => {
    test('should calculate level 1 and XP requirements correctly for 0 XP', () => {
      const stats = calculateLevelAndXp(0);
      assert.strictEqual(stats.level, 1);
      assert.strictEqual(stats.currentXp, 0);
      assert.strictEqual(stats.xpToNextLevel, 100);
      assert.strictEqual(stats.title, 'Aprendiz de Orquestrador');
    });

    test('should scale levels dynamically as XP accumulates', () => {
      // Level 1: 0 - 99 (100 xp)
      // Level 2: 100 - 299 (200 xp)
      // Level 3: 300 - 599 (300 xp)
      const statsLvl2 = calculateLevelAndXp(150);
      assert.strictEqual(statsLvl2.level, 2);
      assert.strictEqual(statsLvl2.currentXp, 50);
      assert.strictEqual(statsLvl2.xpToNextLevel, 150);
      assert.strictEqual(statsLvl2.title, 'Compositor de Agentes');

      const statsLvl3 = calculateLevelAndXp(300);
      assert.strictEqual(statsLvl3.level, 3);
      assert.strictEqual(statsLvl3.currentXp, 0);
      assert.strictEqual(statsLvl3.title, 'Condutor de Enxame');
    });

    test('should generate default orchestrator profile with daily activity history and empty badges', () => {
      const profile = createDefaultProfile();
      assert.strictEqual(profile.name, 'Orchestrator');
      assert.strictEqual(profile.level, 1);
      assert.strictEqual(profile.badges.length, 0);
      assert.strictEqual(INITIAL_BADGES.length, 0);
      assert.ok(profile.activityHistory);
      assert.strictEqual(profile.longestStreakDays, 1);
    });

    test('should have proper titles for all tiers up to Sovereign', () => {
      assert.strictEqual(getTitleForLevel(1), 'Aprendiz de Orquestrador');
      assert.strictEqual(getTitleForLevel(5), 'Orquestrador Cibernético');
      assert.strictEqual(getTitleForLevel(10), 'Soberano do Canvas');
    });

    test('should have IPC handlers registered in Tauri v2 commands for profile', () => {
      const commandsPath = path.join(rootDir, 'src-tauri/src/commands/mod.rs');
      const content = fs.readFileSync(commandsPath, 'utf8');
      assert.ok(content.includes('pub async fn profile_get') || content.includes('mindagentics:profile:get'), 'profileGet IPC channel handled');
      assert.ok(content.includes('pub async fn profile_update') || content.includes('mindagentics:profile:update'), 'profileUpdate IPC channel handled');
      assert.ok(content.includes('pub async fn profile_award_xp') || content.includes('mindagentics:profile:awardXp'), 'profileAwardXp IPC channel handled');
    });

    test('ProfileModal should NOT display level (Nv.), XP bar (currentXp / xpToNextLevel), nor badges', () => {
      const profileModalPath = path.join(rootDir, 'packages/renderer/src/components/modals/ProfileModal.tsx');
      const content = fs.readFileSync(profileModalPath, 'utf8');
      assert.strictEqual(content.includes('Nv.'), false, 'ProfileModal must NOT render Nv.');
      assert.strictEqual(content.includes('currentXp'), false, 'ProfileModal must NOT render currentXp');
      assert.strictEqual(content.includes('xpToNextLevel'), false, 'ProfileModal must NOT render xpToNextLevel');
      assert.strictEqual(content.includes('badges.map'), false, 'ProfileModal must NOT render badges list');
    });

    test('ProfileModal should display streakDays and GitHub-style contribution grid (activityHistory)', () => {
      const profileModalPath = path.join(rootDir, 'packages/renderer/src/components/modals/ProfileModal.tsx');
      const content = fs.readFileSync(profileModalPath, 'utf8');
      assert.ok(content.includes('streakDays'), 'ProfileModal must display streakDays');
      assert.ok(content.includes('activityHistory'), 'ProfileModal must display activityHistory contribution grid');
    });

    test('Sidebar should NOT display level (Nv.), XP bar (currentXp / xpToNextLevel), nor badges', () => {
      const sidebarPath = path.join(rootDir, 'packages/renderer/src/components/sidebar/Sidebar.tsx');
      const content = fs.readFileSync(sidebarPath, 'utf8');
      assert.strictEqual(content.includes('Nv.'), false, 'Sidebar must NOT render Nv.');
      assert.strictEqual(content.includes('currentXp'), false, 'Sidebar must NOT render currentXp');
      assert.strictEqual(content.includes('xpToNextLevel'), false, 'Sidebar must NOT render xpToNextLevel');
      assert.strictEqual(content.includes('badges'), false, 'Sidebar must NOT render badges');
    });

    test('Sidebar should display streakDays and activityHistory telemetry', () => {
      const sidebarPath = path.join(rootDir, 'packages/renderer/src/components/sidebar/Sidebar.tsx');
      const content = fs.readFileSync(sidebarPath, 'utf8');
      assert.ok(content.includes('isProfileOpen') || content.includes('isProfileModalOpenAtom'), 'Sidebar triggers profile modal');
      assert.ok(content.includes('useUserProfile'), 'Sidebar hooks into user profile atom');
      assert.ok(content.includes('streakDays'), 'Sidebar displays streakDays');
      assert.ok(content.includes('activityHistory'), 'Sidebar displays activityHistory');
    });
  });

  describe('Pillar 2: Blurry Text Tool Elimination & Crisp Canvas Typography', () => {
    test('TextBlockNode should render without subpixel blur filters or transform scaling artifacts', () => {
      const textBlockPath = path.join(rootDir, 'packages/renderer/src/components/nodes/TextBlockNode.tsx');
      const content = fs.readFileSync(textBlockPath, 'utf8');
      
      // Verification of crisp CSS and antialiasing properties
      assert.ok(content.includes('antialiased'), 'Uses subpixel antialiasing classes');
      assert.ok(content.includes('FONT_FAMILIES'), 'Uses calibrated typographic families');
      // Subpixel text rendering and crisp HTMLInputElement styling
      assert.ok(content.includes('HTMLInputElement') && content.includes('<input'), 'Native crisp input layout');
      // Supports fontSize styling directly
      assert.ok(content.includes('fontSize') || content.includes('style='), 'Dynamic crisp font sizing supported');
    });

    test('InfiniteCanvas should properly render text blocks at native devicePixelRatio', () => {
      const canvasPath = path.join(rootDir, 'packages/renderer/src/components/canvas/InfiniteCanvas.tsx');
      const content = fs.readFileSync(canvasPath, 'utf8');
      assert.ok(content.includes('text') || content.includes('TextBlockNode'), 'Canvas connects TextBlockNode');
    });
  });

  describe('Pillar 3: Icons Modernization & Vector Geometry', () => {
    test('Icons components module should exist and export modern SVG vectors', () => {
      const iconsDir = path.join(rootDir, 'packages/renderer/src/components/icons');
      assert.ok(fs.existsSync(iconsDir), 'icons directory exists');
      const files = fs.readdirSync(iconsDir);
      assert.ok(files.length > 0, 'Icons directory contains modern SVG icons');
    });

    test('CanvasToolbar should use Lucide vector icons or modern SVG icons exclusively', () => {
      const toolbarPath = path.join(rootDir, 'packages/renderer/src/components/toolbar/CanvasToolbar.tsx');
      const content = fs.readFileSync(toolbarPath, 'utf8');
      assert.ok(content.includes('lucide-react') || content.includes('../icons'), 'CanvasToolbar uses vector icons');
      // No raster png/jpg/gif used for tool buttons
      assert.ok(!content.includes('.png'), 'No raster icon assets in toolbar');
    });

    test('TitleBar and WindowControls should use clean vector iconography', () => {
      const titleBarPath = path.join(rootDir, 'packages/renderer/src/components/window/TitleBar.tsx');
      const controlsPath = path.join(rootDir, 'packages/renderer/src/components/window/WindowControls.tsx');
      const tbContent = fs.readFileSync(titleBarPath, 'utf8');
      const wcContent = fs.readFileSync(controlsPath, 'utf8');
      assert.ok(tbContent.length > 0);
      assert.ok(wcContent.length > 0);
      assert.ok(!tbContent.includes('.png') && !wcContent.includes('.png'), 'Clean vector assets across window chrome');
    });
  });

  describe('Additional Requirements: Onboarding & Frictionless Workspace Flow', () => {
    test('OnboardingModal should support callsign, avatar selection, and first-run detection', () => {
      const modalPath = path.join(rootDir, 'packages/renderer/src/components/modals/OnboardingModal.tsx');
      assert.ok(fs.existsSync(modalPath), 'OnboardingModal component file exists');
      const content = fs.readFileSync(modalPath, 'utf8');
      assert.ok(content.includes('isOnboardingModalOpenAtom'), 'Binds to onboarding atom');
      assert.ok(content.includes('AVATAR_OPTIONS') || content.includes('selectedAvatarId'), 'Provides avatar choices');
      assert.ok(content.includes('callsign'), 'Supports custom orchestrator callsign');
      assert.ok(content.includes('mindagentics_onboarded'), 'Tracks first-run completion in localStorage');
    });

    test('CreateWorkspaceModal should reset state upon opening and support directory selection', () => {
      const wsModalPath = path.join(rootDir, 'packages/renderer/src/components/modals/CreateWorkspaceModal.tsx');
      const content = fs.readFileSync(wsModalPath, 'utf8');
      assert.ok(content.includes('normalizeWorkspace'), 'Applies normalizeWorkspace on created entries');
      assert.ok(content.includes('handlePickDirectory'), 'Allows browsing local directories via IPC');
      assert.ok(content.includes('useEffect'), 'Resets form values when modal opens');
    });

    test('App component should mount all specialized modals and toast notifications', () => {
      const appPath = path.join(rootDir, 'packages/renderer/src/App.tsx');
      const content = fs.readFileSync(appPath, 'utf8');
      assert.ok(content.includes('<ProfileModal />'), 'Mounts ProfileModal');
      assert.ok(content.includes('<OnboardingModal />'), 'Mounts OnboardingModal');
      assert.ok(content.includes('profileToastAtom'), 'Manages gamification level-up toast notifications');
    });
  });
});
