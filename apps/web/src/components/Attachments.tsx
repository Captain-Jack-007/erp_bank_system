// Вложения к любой карточке: <Attachments entity="contract" entityId={c.id} />
// Загрузка (диалог или drag&drop), проверка типа/размера, версии, кто/когда, скачивание, предпросмотр.
import { useEffect, useState } from 'react';
import { fileExtension, filesApi, FileValidationError, formatBytes, formatDateTime, previewKind, tk, validateFile, type StoredFile } from '@xb/shared';
import { Button, Card, Empty, Loading, Modal, Upload, useToast } from './ui';
import { downloadBytes, readFileBytes } from './download';
import { useSession, useUser } from '../lib/session';
import { useApi, useLookups } from '../lib/useApi';

const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.csv,.odt,.ods,.txt,.xml,.json,.jpg,.jpeg,.png,.gif,.webp,.zip,.p7s,.sig';

function Preview({ file, onClose }: { file: StoredFile; onClose: () => void }) {
  const { t } = useSession();
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const kind = previewKind(file.mime, file.name);
  useEffect(() => {
    let u: string | null = null;
    let alive = true;
    filesApi.content(file.id).then((c) => {
      if (!alive) return;
      if (kind === 'text') setText(new TextDecoder().decode(c.data).slice(0, 20000));
      else {
        u = URL.createObjectURL(new Blob([c.data as BlobPart], { type: kind === 'pdf' ? 'application/pdf' : c.mime }));
        setUrl(u);
      }
    });
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [file.id, kind]);
  return (
    <div className="svc-preview-host">
      <Modal title={file.name} onClose={onClose} footer={<Button onClick={onClose}>{t('svc_close')}</Button>}>
        {!kind ? (
          <Empty text={t('svc_noPreview')} icon="file" />
        ) : kind === 'text' ? (
          text === null ? <Loading /> : <pre className="svc-pre">{text}</pre>
        ) : !url ? (
          <Loading />
        ) : kind === 'image' ? (
          <img className="svc-preview-img" src={url} alt={file.name} />
        ) : (
          <iframe className="svc-preview-frame" src={url} title={file.name} />
        )}
      </Modal>
    </div>
  );
}

export function Attachments({ entity, entityId, readOnly, title }: { entity: string; entityId: string; readOnly?: boolean; title?: string }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const lk = useLookups();
  const files = useApi(() => filesApi.list(entity, entityId), [entity, entityId]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<StoredFile | null>(null);
  const [confirm, setConfirm] = useState<StoredFile | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function upload(list: File[], replaceId?: string) {
    setError('');
    const errors: string[] = [];
    setBusy(true);
    try {
      for (const f of list) {
        const code = validateFile(f.name, f.size);
        if (code) {
          errors.push(`${f.name}: ${t(tk('svc_fileErr_', code))}`);
          continue;
        }
        try {
          await filesApi.upload({ entity, entityId, name: f.name, mime: f.type, data: await readFileBytes(f) }, user, replaceId ? { replaceId } : {});
          toast(t('svc_attachUploadedOk'));
        } catch (e) {
          errors.push(`${f.name}: ${e instanceof FileValidationError ? t(tk('svc_fileErr_', e.code)) : t('actionFailed')}`);
        }
      }
    } finally {
      setBusy(false);
      setError(errors.join('; '));
    }
  }

  async function download(f: StoredFile, version?: number) {
    const c = await filesApi.content(f.id, version);
    downloadBytes(c.name, c.mime, c.data);
  }

  const who = (id: string) => lk.user(id)?.fullName ?? id;

  return (
    <Card title={`${title ?? t('svc_attachments')}${files.data?.length ? ` · ${files.data.length}` : ''}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="attachments" data-entity={entity} data-entity-id={entityId}>
        {!readOnly && (
          <Upload dragger multiple accept={ACCEPT} disabled={busy} onFiles={(fs) => upload(fs)} hint={t('svc_attachHint')} ariaLabel={t('svc_attachAdd')}>
            {t('svc_attachDrop')}
          </Upload>
        )}
        {error && (
          <div className="error-text" role="alert">
            {error}
          </div>
        )}
        {files.loading && !files.data ? (
          <Loading />
        ) : !files.data?.length ? (
          <Empty text={t('svc_attachEmpty')} icon="paperclip" />
        ) : (
          <div className="svc-att-list">
            {files.data.map((f) => {
              const last = f.versions[f.versions.length - 1]!;
              return (
                <div key={f.id} className="svc-att" data-testid="attachment-row">
                  <div className="svc-att-icon">{fileExtension(f.name).slice(0, 4) || 'file'}</div>
                  <div className="svc-att-body">
                    <button className="svc-att-name" onClick={() => setPreview(f)} title={t('svc_attachPreview')}>
                      {f.name}
                    </button>
                    <div className="svc-att-meta">
                      v{f.versions.length} · {formatBytes(f.size)} · {who(last.uploadedBy)} · {formatDateTime(last.uploadedAt)}
                      {f.versions.length > 1 && (
                        <>
                          {' · '}
                          <a href="#" onClick={(e) => { e.preventDefault(); setExpanded(expanded === f.id ? null : f.id); }}>
                            {t('svc_attachVersions')}
                          </a>
                        </>
                      )}
                    </div>
                    {expanded === f.id && (
                      <ol className="svc-versions" reversed>
                        {[...f.versions].reverse().map((v) => (
                          <li key={v.version}>
                            <a href="#" onClick={(e) => { e.preventDefault(); void download(f, v.version); }}>
                              v{v.version} · {v.name}
                            </a>{' '}
                            · {formatBytes(v.size)} · {who(v.uploadedBy)} · {formatDateTime(v.uploadedAt)} · <span className="svc-hash">{v.sha256.slice(0, 12)}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                  <div className="svc-att-actions">
                    <Button size="small" type="text" icon="eye" title={t('svc_attachPreview')} onClick={() => setPreview(f)} />
                    <Button size="small" type="text" icon="download" title={t('svc_attachDownload')} onClick={() => void download(f)} />
                    {!readOnly && (
                      <>
                        <Upload accept={ACCEPT} onFiles={(fs) => upload(fs.slice(0, 1), f.id)}>
                          <Button size="small" type="text" icon="upload" title={t('svc_attachNewVersion')} />
                        </Upload>
                        <Button size="small" type="text" danger icon="trash" title={t('svc_attachDelete')} onClick={() => setConfirm(f)} />
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {preview && <Preview file={preview} onClose={() => setPreview(null)} />}
      {confirm && (
        <Modal
          title={t('svc_attachDelete')}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <Button onClick={() => setConfirm(null)}>{t('cancel')}</Button>
              <Button
                danger
                onClick={async () => {
                  await filesApi.remove(confirm.id, user);
                  setConfirm(null);
                  toast(t('svc_attachDeletedOk'));
                }}
              >
                {t('svc_attachDelete')}
              </Button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            <b>{confirm.name}</b>
          </p>
          <p style={{ margin: 0 }} className="muted">
            {t('svc_attachDeleteConfirm')}
          </p>
        </Modal>
      )}
    </Card>
  );
}
