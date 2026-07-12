/** Guild アイコン。画像が無い場合は頭文字を表示する。 */
export function GuildAvatar({
  name,
  iconUrl,
  size = 40,
}: {
  name: string;
  iconUrl: string | null;
  size?: number;
}) {
  const initials = name.slice(0, 2).toUpperCase();

  if (iconUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={iconUrl}
        alt={name}
        width={size}
        height={size}
        className="rounded-xl object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className="flex items-center justify-center rounded-xl bg-primary/10 text-sm font-semibold text-primary"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}
