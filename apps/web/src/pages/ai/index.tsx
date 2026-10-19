import type { ModuleRoute } from '../../lib/routes';
import { AiPage } from './AiPage';

// Маршруты модуля «ИИ-ассистент» (ТЗ 5.3).
export const routes: ModuleRoute[] = [{ path: '/ai', render: () => <AiPage /> }];
