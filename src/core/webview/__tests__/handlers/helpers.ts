import { vi } from "vitest"
import type { MessageHandlerContext } from "../../handlers/MessageRouter"
import { createMockClineProvider } from "../../../../__tests__/helpers/vscodeMocks"

/**
 * Creates a minimal MessageHandlerContext mock for handler unit tests.
 * Only mocks methods that handlers actually call — extend as needed.
 */
export function createMockContext(overrides?: Partial<MessageHandlerContext>): MessageHandlerContext {
	const provider = createMockClineProvider({
		postMessageToWebview: vi.fn().mockResolvedValue(undefined),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		getStateToPostToWebview: vi.fn().mockResolvedValue({}),
		getState: vi.fn().mockResolvedValue({}),
		log: vi.fn(),
		cwd: "/mock/workspace",
		getCurrentTask: vi.fn().mockReturnValue(null),
		handleModeSwitch: vi.fn().mockResolvedValue(undefined),
		handleAskResponse: vi.fn(),
		updateCustomInstructions: vi.fn().mockResolvedValue(undefined),
		getMcpHub: vi.fn().mockReturnValue(null),
		getCurrentWorkspaceCodeIndexManager: vi.fn().mockReturnValue(null),
		clearTask: vi.fn().mockResolvedValue(undefined),
		cancelTask: vi.fn().mockResolvedValue(undefined),
		createTask: vi.fn().mockResolvedValue(undefined),
		exportTaskWithId: vi.fn(),
		showTaskWithId: vi.fn(),
		deleteTaskWithId: vi.fn().mockResolvedValue(undefined),
		getTaskWithAggregatedCosts: vi.fn(),
		condenseTaskContext: vi.fn(),
		planEngine: {
			approvePlan: vi.fn(),
			executePlan: vi.fn().mockResolvedValue(undefined),
			pausePlan: vi.fn(),
			deletePlan: vi.fn(),
			updateStep: vi.fn(),
			getPlan: vi.fn(),
		},
		getModes: vi.fn().mockResolvedValue([]),
		resetState: vi.fn().mockResolvedValue(undefined),
		upsertProviderProfile: vi.fn(),
		activateProviderProfile: vi.fn().mockResolvedValue(undefined),
		providerSettingsManager: {
			saveConfig: vi.fn().mockResolvedValue(undefined),
			listConfig: vi.fn().mockResolvedValue([]),
			deleteConfig: vi.fn().mockResolvedValue(undefined),
			getProfile: vi.fn().mockResolvedValue({}),
			hasConfig: vi.fn().mockResolvedValue(true),
		},
		isViewLaunched: false,
		customModesManager: {
			getCustomModesFilePath: vi.fn().mockResolvedValue("/mock/.njust-ai/custom-modes.json"),
			getCustomModes: vi.fn().mockReturnValue([]),
			deleteCustomMode: vi.fn(),
			updateCustomMode: vi.fn().mockResolvedValue(undefined),
			checkRulesDirectoryHasContent: vi.fn().mockResolvedValue(false),
		},
		contextProxy: {
			storeSecret: vi.fn().mockResolvedValue(undefined),
			setValue: vi.fn().mockResolvedValue(undefined),
			globalStorageUri: { fsPath: "/mock/storage" },
		},
		context: {
			secrets: {
				get: vi.fn().mockResolvedValue(undefined),
			},
			workspaceState: {
				update: vi.fn().mockResolvedValue(undefined),
			},
		},
	})

	const context: MessageHandlerContext = {
		provider,
		getGlobalState: vi.fn().mockReturnValue(undefined),
		updateGlobalState: vi.fn().mockResolvedValue(undefined),
		getCurrentCwd: vi.fn().mockReturnValue("/mock/workspace"),
		getCurrentMode: vi.fn().mockResolvedValue("code"),
		...overrides,
	}

	return context
}
