import type { ModuleRoute } from '../../lib/routes';
import { FtpPage } from './FtpPage';

// Маршруты модуля «Трансфертное ценообразование (FTP)» (ТЗ 4.2.15).
export const routes: ModuleRoute[] = [
  { path: '/ftp', render: () => <FtpPage /> },
  { path: '/ftp/products/:id', render: (p) => <FtpPage productId={p.id!} /> },
];
