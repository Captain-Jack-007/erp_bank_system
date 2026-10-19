import { Card, Empty } from '../components/ui';
import { Link } from '../lib/router';
import { useSession } from '../lib/session';

export function NotFoundPage() {
  const { t } = useSession();
  return (
    <Card>
      <Empty text="404" icon="alert" />
      <div style={{ textAlign: 'center', paddingBottom: 20 }}>
        <Link to="/">{t('navDashboard')}</Link>
      </div>
    </Card>
  );
}
