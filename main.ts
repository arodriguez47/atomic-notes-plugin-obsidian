import { Editor, MarkdownView, Notice, Plugin, EditorPosition, EditorRange, App, PluginSettingTab, Setting, ButtonComponent } from 'obsidian';

interface TagRule {
	tag: string;
	warningLimit: number;
	hardLimit: number;
	enforceHardLimit: boolean;
}

interface AtomicNotesSettings {
	rules: TagRule[];
	isEnabled: boolean;
}

const DEFAULT_SETTINGS: AtomicNotesSettings = {
	rules: [
		{
			tag: "atomic",
			warningLimit: 250,
			hardLimit: 500,
			enforceHardLimit: false
		}
	],
	isEnabled: true
}

export default class AtomicNotesPlugin extends Plugin {
	settings: AtomicNotesSettings;
	private statusBarItem: HTMLElement;
	private ribbonIcon: HTMLElement;
	private isProcessing: boolean = false;
	private lastLength: number = 0;

	async onload() {
		await this.loadSettings();

		// Add ribbon icon
		this.ribbonIcon = this.addRibbonIcon(
			'pencil',
			'Toggle Atomic Notes',
			(evt: MouseEvent) => {
				this.settings.isEnabled = !this.settings.isEnabled;
				this.saveSettings();
				this.updateStatusBar();
				this.updateRibbonIcon();
				
				// Show status notification
				new Notice(
					`Atomic Notes ${this.settings.isEnabled ? 'enabled' : 'disabled'}`
				);

				// If disabled, clear any existing warnings and styling
				if (!this.settings.isEnabled) {
					this.clearWarningsAndStyling();
				}
			}
		);
		this.updateRibbonIcon();

		// Add status bar item
		this.statusBarItem = this.addStatusBarItem();
		this.updateStatusBar();

		// Register event to check content length when editor changes
		this.registerEvent(
			this.app.workspace.on('editor-change', (editor: Editor) => {
				if (this.settings.isEnabled && !this.isProcessing) {
					this.checkNoteLength(editor);
				}
			})
		);

		// Add settings tab
		this.addSettingTab(new AtomicNotesSettingTab(this.app, this));
	}

	private clearWarningsAndStyling() {
		const warningEl = document.querySelector('.atomic-notes-warning');
		if (warningEl) warningEl.remove();

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view?.editor) {
			const content = view.editor.getValue();
			view.editor.setValue(content);
		}
	}

	public updateRibbonIcon() {
		this.ribbonIcon.removeClass('atomic-notes-ribbon-enabled', 'atomic-notes-ribbon-disabled');
		this.ribbonIcon.addClass(
			this.settings.isEnabled ? 'atomic-notes-ribbon-enabled' : 'atomic-notes-ribbon-disabled'
		);
	}

	public updateStatusBar() {
		const status = this.settings.isEnabled ? 'enabled' : 'disabled';
		this.statusBarItem.empty();
		this.statusBarItem.createSpan({
			text: `Atomic Notes: ${status}`,
			cls: this.settings.isEnabled ? 'atomic-notes-status-enabled' : 'atomic-notes-status-disabled'
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private getActiveRule(content: string): TagRule | null {
		for (const rule of this.settings.rules) {
			// Check for tag in body
			if (content.includes(`#${rule.tag}`)) {
				console.log(`Found tag #${rule.tag} in body`);
				return rule;
			}
			
			// Check for tag in YAML frontmatter or properties
			const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
			if (frontmatterMatch) {
				const frontmatterContent = frontmatterMatch[1];
				console.log('Found frontmatter:', frontmatterContent);
				
				// Extract the tags section including all indented lines
				const tagLines = frontmatterContent.split('\n');
				let inTagSection = false;
				let tags: string[] = [];
				
				for (let i = 0; i < tagLines.length; i++) {
					const line = tagLines[i];
					
					// Start of tags section
					if (line.trim().startsWith('tags:')) {
						inTagSection = true;
						// Check if it's an inline array format
						const inlineMatch = line.match(/tags:\s*\[(.*?)\]/);
						if (inlineMatch) {
							tags = inlineMatch[1].split(',').map(tag => tag.trim());
							break;
						}
						// Check if it's an inline simple format
						const simpleMatch = line.match(/tags:\s*(.+)$/);
						if (simpleMatch) {
							tags = simpleMatch[1].split(',').map(tag => tag.trim());
							break;
						}
						continue;
					}
					
					// If we're in the tags section and line starts with a dash, it's a tag
					if (inTagSection && line.trim().startsWith('-')) {
						const tag = line.replace(/\s*-\s*/, '').trim();
						if (tag) {
							tags.push(tag);
						}
					}
					// If we're in the tags section and hit a non-indented line, we're done
					else if (inTagSection && line.trim() !== '' && !line.startsWith(' ')) {
						break;
					}
				}
				
				console.log('Parsed tags:', tags);
				console.log('Looking for tag:', rule.tag);
				
				// Check if our rule's tag is in the list
				if (tags.includes(rule.tag)) {
					console.log(`Found matching tag: ${rule.tag}`);
					return rule;
				}
			}
		}
		console.log('No matching tag found');
		return null;
	}

	private getContentWithoutFrontmatter(content: string): string {
		// Match YAML frontmatter between --- markers
		const yamlMatch = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)/);
		if (yamlMatch) {
			return yamlMatch[1];
		}
		return content;
	}

	private checkNoteLength(editor: Editor) {
		try {
			this.isProcessing = true;
			const fullContent = editor.getValue();
			console.log('Full content:', fullContent);
			
			const activeRule = this.getActiveRule(fullContent);
			console.log('Active rule:', activeRule);
			
			// Only apply limits if a matching tag is present
			if (!activeRule) {
				console.log('No active rule found - clearing warnings');
				this.clearWarningsAndStyling();
				return;
			}

			// Get content without frontmatter for length calculation
			const contentWithoutFrontmatter = this.getContentWithoutFrontmatter(fullContent);
			const length = contentWithoutFrontmatter.length;
			console.log('Content length (without frontmatter):', length, 'Warning limit:', activeRule.warningLimit);

			// If enforcing hard limit and length would exceed it, prevent the change
			if (activeRule.enforceHardLimit && length > activeRule.hardLimit) {
				console.log('Hard limit exceeded');
				if (this.lastLength <= activeRule.hardLimit) {
					// Get the YAML frontmatter if it exists
					const yamlMatch = fullContent.match(/^---\n[\s\S]*?\n---\n/);
					const frontmatter = yamlMatch ? yamlMatch[0] : '';
					
					// Only truncate if we just crossed the limit
					editor.setValue(frontmatter + contentWithoutFrontmatter.substring(0, activeRule.hardLimit));
					new Notice(`Cannot exceed ${activeRule.hardLimit} characters when using #${activeRule.tag}`);
				} else {
					// Otherwise, prevent the change
					const yamlMatch = fullContent.match(/^---\n[\s\S]*?\n---\n/);
					const frontmatter = yamlMatch ? yamlMatch[0] : '';
					editor.setValue(frontmatter + contentWithoutFrontmatter.substring(0, activeRule.hardLimit));
				}
				this.lastLength = activeRule.hardLimit;
				return;
			}

			this.lastLength = length;

			// Handle warning display
			if (length > activeRule.warningLimit) {
				console.log('Warning limit exceeded - displaying warning');
				const remaining = activeRule.hardLimit - length;
				const warningEl = document.createElement('div');
				warningEl.addClass('atomic-notes-warning');
				warningEl.setText(`${remaining} characters remaining ${activeRule.enforceHardLimit ? 'before limit' : 'until color change'} (${activeRule.tag} rule)`);
				
				// Remove any existing warning
				const existingWarning = document.querySelector('.atomic-notes-warning');
				if (existingWarning) {
					console.log('Removing existing warning');
					existingWarning.remove();
				}

				// Add warning below editor
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (view) {
					console.log('Appending warning to view');
					view.contentEl.appendChild(warningEl);
				} else {
					console.log('No active view found');
				}
			} else {
				console.log('Under warning limit - removing any existing warnings');
				const warningEl = document.querySelector('.atomic-notes-warning');
				if (warningEl) {
					warningEl.remove();
				}
			}

			// Apply overflow styling using CSS classes if not enforcing hard limit
			if (!activeRule.enforceHardLimit && length > activeRule.hardLimit) {
				console.log('Applying overflow styling');
				const yamlMatch = fullContent.match(/^---\n[\s\S]*?\n---\n/);
				const frontmatter = yamlMatch ? yamlMatch[0] : '';
				const normalContent = contentWithoutFrontmatter.substring(0, activeRule.hardLimit);
				const overflowContent = contentWithoutFrontmatter.substring(activeRule.hardLimit);
				
				// Use HTML to style the overflow text
				const newContent = frontmatter + normalContent + `<span class="atomic-notes-overflow">${overflowContent}</span>`;
				editor.setValue(newContent);
			}
		} finally {
			this.isProcessing = false;
		}
	}
}

class AtomicNotesSettingTab extends PluginSettingTab {
	plugin: AtomicNotesPlugin;

	constructor(app: App, plugin: AtomicNotesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		// Add global enable/disable setting
		new Setting(containerEl)
			.setName('Enable plugin')
			.setDesc('Toggle the plugin on/off')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.isEnabled)
				.onChange(async (value) => {
					this.plugin.settings.isEnabled = value;
					await this.plugin.saveSettings();
					this.plugin.updateStatusBar();
					this.plugin.updateRibbonIcon();
				}));

		containerEl.createEl('h2', {text: 'Character Limit Rules'});

		// Add existing rules
		this.plugin.settings.rules.forEach((rule, index) => {
			this.addRuleSettings(containerEl, rule, index);
		});

		// Add button to create new rule
		new ButtonComponent(containerEl)
			.setButtonText("Add New Rule")
			.onClick(async () => {
				this.plugin.settings.rules.push({
					tag: "new-tag",
					warningLimit: 250,
					hardLimit: 500,
					enforceHardLimit: false
				});
				await this.plugin.saveSettings();
				this.display();
			});
	}

	private addRuleSettings(containerEl: HTMLElement, rule: TagRule, index: number): void {
		const ruleContainer = containerEl.createDiv();
		ruleContainer.addClass('rule-container');

		// Add rule header
		ruleContainer.createEl('h3', {text: `Rule ${index + 1}`});

		// Tag setting
		new Setting(ruleContainer)
			.setName('Tag')
			.setDesc('Tag to trigger this rule (without #)')
			.addText(text => text
				.setValue(rule.tag)
				.onChange(async (value) => {
					rule.tag = value;
					await this.plugin.saveSettings();
				}));

		// Warning limit setting
		new Setting(ruleContainer)
			.setName('Warning limit')
			.setDesc('Character count at which to show warning')
			.addText(text => text
				.setValue(rule.warningLimit.toString())
				.onChange(async (value) => {
					rule.warningLimit = parseInt(value);
					await this.plugin.saveSettings();
				}));

		// Hard limit setting
		new Setting(ruleContainer)
			.setName('Hard limit')
			.setDesc('Character count at which to enforce limit or change color')
			.addText(text => text
				.setValue(rule.hardLimit.toString())
				.onChange(async (value) => {
					rule.hardLimit = parseInt(value);
						await this.plugin.saveSettings();
				}));

		// Enforce hard limit setting
		new Setting(ruleContainer)
			.setName('Enforce hard limit')
			.setDesc('Prevent typing beyond the hard limit instead of just changing color')
			.addToggle(toggle => toggle
				.setValue(rule.enforceHardLimit)
				.onChange(async (value) => {
					rule.enforceHardLimit = value;
					await this.plugin.saveSettings();
				}));

		// Delete rule button (don't allow deleting the last rule)
		if (this.plugin.settings.rules.length > 1) {
			new ButtonComponent(ruleContainer)
				.setButtonText("Delete Rule")
				.onClick(async () => {
					this.plugin.settings.rules.splice(index, 1);
					await this.plugin.saveSettings();
					this.display();
				});
		}

		// Add separator
		ruleContainer.createEl('hr');
	}
}
