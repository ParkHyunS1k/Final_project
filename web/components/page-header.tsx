// 앱 화면의 페이지 머리(UI 공통 규칙, 2026-11-15). 화면마다 같은 모양: 왼쪽 제목·한 줄 설명, 오른쪽 버튼.
// 영어 소제목·랜딩식 큰 카피는 쓰지 않는다(랜딩 페이지에만).
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}
