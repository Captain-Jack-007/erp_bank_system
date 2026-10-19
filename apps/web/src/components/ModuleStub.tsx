import { Card, Empty, PageHeader } from './ui';

/** Временная заглушка экрана модуля. */
export function ModuleStub({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <Empty text="…" icon="sparkles" />
      </Card>
    </>
  );
}
