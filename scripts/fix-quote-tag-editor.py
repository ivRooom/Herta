from pathlib import Path

path = Path('apps/studio/src/components/quote-manager.tsx')
text = path.read_text()

text = text.replace(
    "  const [tags, setTags] = useState('');\n  const [status, setStatus] = useState('public');",
    "  const [tags, setTags] = useState('');\n  const [tagDraft, setTagDraft] = useState('');\n  const [status, setStatus] = useState('public');",
    1,
)

text = text.replace(
    "    try {\n      await apiRequest(`/api/guilds/${guildId}/quotes`, {",
    "    try {\n      const tagsToSave = mergeTagDraft(tags, tagDraft);\n      await apiRequest(`/api/guilds/${guildId}/quotes`, {",
    1,
)
text = text.replace(
    "          tags,\n          status,",
    "          tags: tagsToSave,\n          status,",
    1,
)
text = text.replace(
    "      setTags('');\n      setStatus('public');",
    "      setTags('');\n      setTagDraft('');\n      setStatus('public');",
    1,
)

text = text.replace(
    '<TagEditor value={tags} onChange={setTags} ariaLabel="新しいQuoteのタグ" />',
    '''<TagEditor
                value={tags}
                onChange={setTags}
                draft={tagDraft}
                onDraftChange={setTagDraft}
                ariaLabel="新しいQuoteのタグ"
              />''',
    1,
)

text = text.replace(
    "  const [tags, setTags] = useState(item.tags.join(', '));\n  const [status, setStatus] = useState(item.status);",
    "  const [tags, setTags] = useState(item.tags.join(', '));\n  const [tagDraft, setTagDraft] = useState('');\n  const [status, setStatus] = useState(item.status);",
    1,
)
text = text.replace(
    "    try {\n      await apiRequest(`/api/guilds/${guildId}/quotes/${item.quoteNumber}`, {",
    "    try {\n      const tagsToSave = mergeTagDraft(tags, tagDraft);\n      await apiRequest(`/api/guilds/${guildId}/quotes/${item.quoteNumber}`, {",
    1,
)
text = text.replace(
    "        body: JSON.stringify({ quoteText, sourceAuthorName, tags, status, isNsfw }),\n      });\n      setMessage('保存しました');",
    "        body: JSON.stringify({ quoteText, sourceAuthorName, tags: tagsToSave, status, isNsfw }),\n      });\n      setTags(tagsToSave);\n      setTagDraft('');\n      setMessage('保存しました');",
    1,
)
text = text.replace(
    '''        <TagEditor value={tags} onChange={setTags} ariaLabel={`Quote #${item.quoteNumber} タグ`} />''',
    '''        <TagEditor
          value={tags}
          onChange={setTags}
          draft={tagDraft}
          onDraftChange={setTagDraft}
          ariaLabel={`Quote #${item.quoteNumber} タグ`}
        />''',
    1,
)

text = text.replace(
    "const VISIBILITY_OPTIONS = [",
    "const MAX_QUOTE_TAGS = 5;\nconst MAX_QUOTE_TAG_LENGTH = 32;\n\nconst VISIBILITY_OPTIONS = [",
    1,
)

start = text.index('function TagEditor({')
end = text.index('\nfunction visibilityLabel(', start)
replacement = r'''function TagEditor({
  value,
  onChange,
  draft,
  onDraftChange,
  ariaLabel,
}: {
  value: string;
  onChange(value: string): void;
  draft: string;
  onDraftChange(value: string): void;
  ariaLabel: string;
}) {
  const tags = normalizeTags(value);

  function commitTag(raw: string) {
    const normalized = normalizeTag(raw);
    if (!normalized) return;
    if (
      tags.length < MAX_QUOTE_TAGS &&
      !tags.some((tag) => tag.toLocaleLowerCase('ja') === normalized.toLocaleLowerCase('ja'))
    ) {
      onChange([...tags, normalized].join(', '));
    }
    onDraftChange('');
  }

  function removeTag(tag: string) {
    onChange(tags.filter((candidate) => candidate !== tag).join(', '));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commitTag(draft);
      return;
    }
    const lastTag = tags.at(-1);
    if (event.key === 'Backspace' && !draft && lastTag) {
      removeTag(lastTag);
    }
  }

  const tagLimitReached = tags.length >= MAX_QUOTE_TAGS;

  return (
    <div className="rounded-xl border border-border bg-background p-2 focus-within:ring-2 focus-within:ring-ring">
      {tags.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => removeTag(tag)}
              className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs hover:border-destructive/40 hover:text-destructive"
              aria-label={`${tag} タグを削除`}
            >
              #{tag} ×
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          aria-label={ariaLabel}
          className="min-w-0 flex-1 bg-transparent px-1 py-1 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50"
          placeholder={tagLimitReached ? 'タグ上限に達しました' : tags.length === 0 ? 'タグを入力してEnter' : 'タグを追加'}
          maxLength={MAX_QUOTE_TAG_LENGTH}
          disabled={tagLimitReached}
        />
        <button
          type="button"
          onClick={() => commitTag(draft)}
          disabled={!draft.trim() || tagLimitReached}
          className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium disabled:opacity-40"
        >
          追加
        </button>
      </div>
      <p className="mt-1 px-1 text-[11px] text-muted">
        Enterまたはカンマで追加 · 最大{MAX_QUOTE_TAGS}件 · 1タグ{MAX_QUOTE_TAG_LENGTH}文字
      </p>
    </div>
  );
}

function normalizeTag(value: string): string {
  return value.trim().replace(/^#/, '').slice(0, MAX_QUOTE_TAG_LENGTH);
}

function normalizeTags(value: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of value.split(',')) {
    const tag = normalizeTag(raw);
    if (!tag) continue;
    const key = tag.toLocaleLowerCase('ja');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
    if (result.length >= MAX_QUOTE_TAGS) break;
  }
  return result;
}

function mergeTagDraft(value: string, draft: string): string {
  const tags = normalizeTags(value);
  const pending = normalizeTag(draft);
  if (
    pending &&
    tags.length < MAX_QUOTE_TAGS &&
    !tags.some((tag) => tag.toLocaleLowerCase('ja') === pending.toLocaleLowerCase('ja'))
  ) {
    tags.push(pending);
  }
  return tags.join(', ');
}
'''
text = text[:start] + replacement + text[end:]

path.write_text(text)
