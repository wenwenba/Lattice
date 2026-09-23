import type { SlashCommand } from './slash.js';

export const languages = { en: 'English', 'zh-CN': '简体中文' } as const;
export type Language = keyof typeof languages;

export function translate(language: Language, english: string, chinese: string): string {
  return language === 'zh-CN' ? chinese : english;
}

const commandChinese: Record<string, string> = {
  'Quick note': '随记', 'Organize saved note with AI': '使用 AI 整理当前笔记', 'AI model configuration': '配置 AI 模型',
  'Move file or folder': '移动文件或文件夹', 'Import local file or folder': '导入本地文件或文件夹', Settings: '设置',
  'New note': '新建笔记', 'New folder': '新建文件夹', 'Rename selected': '重命名所选项目',
  'Delete selected file or folder': '删除所选文件或文件夹', 'Edit / preview': '编辑 / 预览', 'Search vault': '搜索 Vault',
  'Trash and restore': '回收站与恢复', 'Link health': '链接检查', Backlinks: '反向链接',
  'Reload vault': '重新加载 Vault', 'Keyboard help': '键盘帮助', Quit: '退出',
};

const slashChinese: Record<string, [string, string]> = {
  'heading-1': ['一级标题', '插入大标题'], 'heading-2': ['二级标题', '插入中标题'], 'heading-3': ['三级标题', '插入小标题'],
  'bullet-list': ['无序列表', '开始无序列表'], 'numbered-list': ['有序列表', '开始有序列表'], task: ['任务', '插入未完成任务'],
  quote: ['引用', '插入引用块'], code: ['代码块', '插入围栏代码块'], table: ['表格', '插入两列表格'],
  'wiki-link': ['Wiki 链接', '链接另一篇笔记'], 'file-link': ['Vault 文件链接', '选择 Vault 内的文件'], image: ['图片', '插入 Vault 图片'],
  'extract-note': ['提取为笔记', '将选中文字变成链接笔记'],
  callout: ['提示块', '插入 Obsidian 风格提示'], divider: ['分隔线', '插入水平分隔线'], save: ['保存笔记', '保存当前草稿'],
};

export function commandTitle(language: Language, label: string): string {
  return translate(language, label, commandChinese[label] ?? label);
}

export function slashTitle(language: Language, command: SlashCommand): string {
  return translate(language, command.label, slashChinese[command.id]?.[0] ?? command.label);
}

export function slashDescription(language: Language, command: SlashCommand): string {
  return translate(language, command.description, slashChinese[command.id]?.[1] ?? command.description);
}
