import { initials } from '@/lib/format';

interface AvatarProps {
  name: string;
  color: string;
  fileId?: number | null;
  size?: number;
  online?: boolean;
}

/** Кружок с инициалами или загруженной картинкой. */
export default function Avatar({ name, color, fileId, size = 42, online }: AvatarProps) {
  return (
    <div
      className={`avatar avatar-${color}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      aria-hidden
    >
      {fileId ? (
        // Аватарка отдаётся тем же защищённым маршрутом, что и вложения.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/files/${fileId}`} alt="" width={size} height={size} />
      ) : (
        initials(name)
      )}
      {online ? <span className="avatar-online-dot" /> : null}
    </div>
  );
}
