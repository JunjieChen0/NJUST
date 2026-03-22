// npx vitest run src/__tests__/index.test.ts

import { generatePackageJson } from "../index.js"

describe("generatePackageJson", () => {
	it("should be a test", () => {
		const generatedPackageJson = generatePackageJson({
			packageJson: {
				name: "njust-ai-cj",
				displayName: "%extension.displayName%",
				description: "%extension.description%",
				publisher: "RooVeterinaryInc",
				version: "3.17.2",
				icon: "assets/icons/icon.png",
				contributes: {
					viewsContainers: {
						activitybar: [
							{
								id: "njust-ai-cj-ActivityBar",
								title: "%views.activitybar.title%",
								icon: "assets/icons/icon.svg",
							},
						],
					},
					views: {
						"njust-ai-cj-ActivityBar": [
							{
								type: "webview",
								id: "njust-ai-cj.SidebarProvider",
								name: "",
							},
						],
					},
					commands: [
						{
							command: "njust-ai-cj.plusButtonClicked",
							title: "%command.newTask.title%",
							icon: "$(edit)",
						},
						{
							command: "njust-ai-cj.openInNewTab",
							title: "%command.openInNewTab.title%",
							category: "%configuration.title%",
						},
					],
					menus: {
						"editor/context": [
							{
								submenu: "njust-ai-cj.contextMenu",
								group: "navigation",
							},
						],
						"njust-ai-cj.contextMenu": [
							{
								command: "njust-ai-cj.addToContext",
								group: "1_actions@1",
							},
						],
						"editor/title": [
							{
								command: "njust-ai-cj.plusButtonClicked",
								group: "navigation@1",
								when: "activeWebviewPanelId == njust-ai-cj.TabPanelProvider",
							},
							{
								command: "njust-ai-cj.settingsButtonClicked",
								group: "navigation@6",
								when: "activeWebviewPanelId == njust-ai-cj.TabPanelProvider",
							},
							{
								command: "njust-ai-cj.accountButtonClicked",
								group: "navigation@6",
								when: "activeWebviewPanelId == njust-ai-cj.TabPanelProvider",
							},
						],
					},
					submenus: [
						{
							id: "njust-ai-cj.contextMenu",
							label: "%views.contextMenu.label%",
						},
						{
							id: "njust-ai-cj.terminalMenu",
							label: "%views.terminalMenu.label%",
						},
					],
					configuration: {
						title: "%configuration.title%",
						properties: {
							"njust-ai-cj.allowedCommands": {
								type: "array",
								items: {
									type: "string",
								},
								default: ["npm test", "npm install", "tsc", "git log", "git diff", "git show"],
								description: "%commands.allowedCommands.description%",
							},
							"njust-ai-cj.customStoragePath": {
								type: "string",
								default: "",
								description: "%settings.customStoragePath.description%",
							},
						},
					},
				},
				scripts: {
					lint: "eslint **/*.ts",
				},
			},
			overrideJson: {
				name: "njust-ai-cj-nightly",
				displayName: "NJUST_AI_CJ Nightly",
				publisher: "RooVeterinaryInc",
				version: "0.0.1",
				icon: "assets/icons/icon-nightly.png",
				scripts: {},
			},
			substitution: ["njust-ai-cj", "njust-ai-cj-nightly"],
		})

		expect(generatedPackageJson).toStrictEqual({
			name: "njust-ai-cj-nightly",
			displayName: "NJUST_AI_CJ Nightly",
			description: "%extension.description%",
			publisher: "RooVeterinaryInc",
			version: "0.0.1",
			icon: "assets/icons/icon-nightly.png",
			contributes: {
				viewsContainers: {
					activitybar: [
						{
							id: "njust-ai-cj-nightly-ActivityBar",
							title: "%views.activitybar.title%",
							icon: "assets/icons/icon.svg",
						},
					],
				},
				views: {
					"njust-ai-cj-nightly-ActivityBar": [
						{
							type: "webview",
							id: "njust-ai-cj-nightly.SidebarProvider",
							name: "",
						},
					],
				},
				commands: [
					{
						command: "njust-ai-cj-nightly.plusButtonClicked",
						title: "%command.newTask.title%",
						icon: "$(edit)",
					},
					{
						command: "njust-ai-cj-nightly.openInNewTab",
						title: "%command.openInNewTab.title%",
						category: "%configuration.title%",
					},
				],
				menus: {
					"editor/context": [
						{
							submenu: "njust-ai-cj-nightly.contextMenu",
							group: "navigation",
						},
					],
					"njust-ai-cj-nightly.contextMenu": [
						{
							command: "njust-ai-cj-nightly.addToContext",
							group: "1_actions@1",
						},
					],
					"editor/title": [
						{
							command: "njust-ai-cj-nightly.plusButtonClicked",
							group: "navigation@1",
							when: "activeWebviewPanelId == njust-ai-cj-nightly.TabPanelProvider",
						},
						{
							command: "njust-ai-cj-nightly.settingsButtonClicked",
							group: "navigation@6",
							when: "activeWebviewPanelId == njust-ai-cj-nightly.TabPanelProvider",
						},
						{
							command: "njust-ai-cj-nightly.accountButtonClicked",
							group: "navigation@6",
							when: "activeWebviewPanelId == njust-ai-cj-nightly.TabPanelProvider",
						},
					],
				},
				submenus: [
					{
						id: "njust-ai-cj-nightly.contextMenu",
						label: "%views.contextMenu.label%",
					},
					{
						id: "njust-ai-cj-nightly.terminalMenu",
						label: "%views.terminalMenu.label%",
					},
				],
				configuration: {
					title: "%configuration.title%",
					properties: {
						"njust-ai-cj-nightly.allowedCommands": {
							type: "array",
							items: {
								type: "string",
							},
							default: ["npm test", "npm install", "tsc", "git log", "git diff", "git show"],
							description: "%commands.allowedCommands.description%",
						},
						"njust-ai-cj-nightly.customStoragePath": {
							type: "string",
							default: "",
							description: "%settings.customStoragePath.description%",
						},
					},
				},
			},
			scripts: {},
		})
	})
})
