import { useEffect,useId,useRef,useState } from 'react';
import { ChevronDown,Copy,Dices,Download,Eye,EyeOff,FileText,Terminal,Upload } from 'lucide-react';
import { Dialog,DialogContent,DialogHeader,DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/ui/inline-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { vaultApi } from '@/api/vault';
import { toast } from 'sonner';
import { useVaultStore } from '@/store/vault';
import { buildPrivateKeyFilename,buildPublicKeyImportCommand } from '@/lib/vaultKeyActions';
import { saveTextToDisk } from '@/lib/desktop';
import { getPlatformCapabilities } from '@/lib/platform';
import { documentApi } from '@/api/document';
import { normalizeVaultUsername } from '@/lib/vaultUsername';
import { writeClipboardText } from '@/lib/clipboard';
import { VAULT_TYPE_LABELS,type VaultCreateRequest,type VaultItem,type VaultType } from '@/types/vault';
import { VaultPasswordGenerator } from './VaultPasswordGenerator';
interface VaultFormDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    item?: VaultItem | null;
}
interface VaultFormDialogInnerProps {
    item?: VaultItem | null;
    onOpenChange: (open: boolean) => void;
    onStateChange?: (state: VaultEditorState) => void;
    onSaved?: (item: VaultItem) => void;
}
export interface VaultEditorState { dirty: boolean; busy: boolean }
const TYPE_OPTIONS = (Object.keys(VAULT_TYPE_LABELS) as VaultType[]).map((type) => ({
    value: type,
    label: VAULT_TYPE_LABELS[type],
}));
const EMPTY_FORM: VaultCreateRequest = {
    name: '',
    type: 'password',
    username: '',
    remark: '',
    password: '',
    private_key: '',
    public_key: '',
    passphrase: '',
};
function buildInitialForm(item?: VaultItem | null): VaultCreateRequest {
    if (!item)
        return { ...EMPTY_FORM };
    return {
        name: item.name,
        type: item.type,
        username: item.type === 'password' ? item.username : '',
        remark: item.remark,
        password: '',
        private_key: '',
        public_key: '',
        passphrase: '',
    };
}
function isSameForm(left: VaultCreateRequest, right: VaultCreateRequest): boolean {
    return (left.name === right.name &&
        left.type === right.type &&
        left.username === right.username &&
        left.remark === right.remark &&
        left.password === right.password &&
        left.private_key === right.private_key &&
        left.public_key === right.public_key &&
        left.passphrase === right.passphrase);
}
function PasswordEditorSection({ password, isEditing, showGenerator, onPasswordChange, onToggleGenerator, onApplyGeneratedPassword, }: {
    password: string;
    isEditing: boolean;
    showGenerator: boolean;
    onPasswordChange: (value: string) => void;
    onToggleGenerator: () => void;
    onApplyGeneratedPassword: (password: string) => void;
}) {
    const [showPassword, setShowPassword] = useState(false);
    return (<section className="vault-form-password-panel">
      <div className="vault-form-password-head">
        <span className="vault-form-password-title">密码</span>
        <div className="vault-form-password-actions">
          <Button type="button" variant="outline" size="icon" onClick={() => setShowPassword((current) => !current)} className="vault-sheet-inline-btn vault-form-password-toggle" title={showPassword ? '隐藏密码' : '显示密码'} aria-label={showPassword ? '隐藏密码' : '显示密码'}>
            {showPassword ? <EyeOff size={14}/> : <Eye size={14}/>}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onToggleGenerator} className="vault-sheet-inline-btn">
            <Dices size={13}/>
            {showGenerator ? '收起' : '生成'}
          </Button>
        </div>
      </div>

      <Input aria-label="密码" type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => onPasswordChange(event.target.value)} placeholder="输入密码" required className="pf-input-mono vault-form-password-input"/>

      <div className="vault-form-password-hint">
        {isEditing ? '类型固定，凭据内容可以更新。' : '创建后类型不可修改。'}
      </div>

      {showGenerator ? <VaultPasswordGenerator onApply={onApplyGeneratedPassword}/> : null}
    </section>);
}
export function VaultFormDialog({ open, onOpenChange, item }: VaultFormDialogProps) {
    const instanceKey = `${item?.id ?? 'new'}:${open ? 'open' : 'closed'}`;
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="vault-sheet-dialog-content vault-form-dialog-content">
        <DialogHeader className="vault-sheet-header">
          <div className="vault-sheet-header-top">
            <div className="vault-sheet-title-wrap">
              <span className="vault-sheet-eyebrow">Vault</span>
              <DialogTitle>{item ? '编辑凭据' : '新建凭据'}</DialogTitle>
            </div>
          </div>
        </DialogHeader>

        {open ? <VaultForm key={instanceKey} item={item} onOpenChange={onOpenChange}/> : null}
      </DialogContent>
    </Dialog>);
}
export function VaultForm({ item, onOpenChange, onStateChange, onSaved }: VaultFormDialogInnerProps) {
    const formId = useId();
    const { create, update } = useVaultStore();
    const isEditing = !!item;
    const [form, setForm] = useState<VaultCreateRequest>(() => buildInitialForm(item));
    const [initialForm, setInitialForm] = useState<VaultCreateRequest>(() => buildInitialForm(item));
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [credentialLoading, setCredentialLoading] = useState(!!item);
    const [credentialError, setCredentialError] = useState(false);
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [showGenerator, setShowGenerator] = useState(false);
    const [showPrivateKey, setShowPrivateKey] = useState(false);
    const publicKeyFileRef = useRef<HTMLInputElement>(null);
    const privateKeyFileRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (!item)
            return;
        let cancelled = false;
        setCredentialLoading(true);
        setCredentialError(false);
        vaultApi
            .reveal(item.id)
            .then((credential) => {
            if (cancelled) return;
            const nextForm: VaultCreateRequest = {
                ...buildInitialForm(item),
                password: credential.password ?? '',
                private_key: credential.private_key ?? '',
                public_key: credential.public_key ?? '',
                passphrase: credential.passphrase ?? '',
            };
            setForm((current) => ({
                ...current,
                ...nextForm,
            }));
            setInitialForm(nextForm);
        })
            .catch(() => { if (!cancelled) setCredentialError(true); })
            .finally(() => { if (!cancelled) setCredentialLoading(false); });
        return () => { cancelled = true; };
    }, [item, loadAttempt]);
    const dirty = !isSameForm(form, initialForm);
    useEffect(() => { onStateChange?.({ dirty, busy: loading }); }, [dirty, loading, onStateChange]);
    const readFile = (file: File, field: 'private_key' | 'public_key') => {
        if (file.size > 100 * 1024) {
            toast.warning('文件过大，请控制在 100KB 以内');
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            setForm((current) => ({ ...current, [field]: String(reader.result ?? '') }));
            toast.success('文件已导入');
        };
        reader.onerror = () => toast.error('读取文件失败');
        reader.readAsText(file);
    };
    const pickKeyDocument = async (field: 'private_key' | 'public_key') => {
            const ref = field === 'private_key' ? privateKeyFileRef : publicKeyFileRef;
            ref.current?.click();
            return;
        };
    const updateField = <K extends keyof VaultCreateRequest>(key: K, value: VaultCreateRequest[K]) => {
        setForm((current) => ({ ...current, [key]: value }));
    };
    const canSubmit = !loading && !credentialLoading && !credentialError && (!isEditing || dirty);
    const handleExportPrivateKey = async () => {
        const privateKey = form.private_key?.trim();
        if (!privateKey) {
            toast.warning('暂无可导出的私钥');
            return;
        }
        // 桌面端（Electron）：主进程系统保存对话框（blob 锚点在 WKWebView/WebKitGTK 下不可靠）
        if (getPlatformCapabilities().nativeFilePaths) {
            try {
                const saved = await saveTextToDisk(`${privateKey}\n`, buildPrivateKeyFilename(form.name));
                if (saved)
                    toast.success('私钥文件已导出');
            }
            catch (err) {
                toast.error('导出失败', { description: err instanceof Error ? err.message : String(err) });
            }
            return;
        }
        if (getPlatformCapabilities().documentPicker) {
            try {
                const saved = await documentApi.exportText(`${privateKey}\n`, buildPrivateKeyFilename(form.name), 'application/x-pem-file');
                if (saved)
                    toast.success('私钥文件已导出');
            }
            catch (err) {
                toast.error('导出失败', { description: err instanceof Error ? err.message : String(err) });
            }
            return;
        }
        const blob = new Blob([`${privateKey}\n`], { type: 'application/x-pem-file;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = buildPrivateKeyFilename(form.name);
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        toast.success('私钥文件已导出');
    };
    const handleCopyPublicKey = async (mode: 'content' | 'command') => {
        const publicKey = form.public_key?.trim();
        if (!publicKey) {
            toast.warning('暂无可复制的公钥');
            return;
        }
        const text = mode === 'content' ? publicKey : buildPublicKeyImportCommand(publicKey);
        try {
            await writeClipboardText(text);
            toast.success(mode === 'content' ? '公钥内容已复制' : '公钥导入指令已复制');
        }
        catch {
            toast.error('复制失败，请检查剪贴板权限');
        }
    };
    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!canSubmit) return;
        if (!form.name?.trim()) {
            setError('名称不能为空');
            return;
        }
        if (form.type === 'password' && !form.username?.trim()) {
            setError('密码凭据必须设置用户名');
            return;
        }
        const payload: VaultCreateRequest = {
            ...form,
            name: form.name.trim(),
            username: normalizeVaultUsername(form.type, form.username),
        };
        setLoading(true);
        setError('');
        try {
            const saved = isEditing && item ? await update(item.id, payload) : await create(payload);
            if (onSaved) onSaved(saved);
            else onOpenChange(false);
        }
        catch (err) {
            const message = (err as {
                error?: {
                    message?: string;
                };
            })?.error?.message ?? (err as Error).message;
            setError(message || '操作失败');
        }
        finally {
            setLoading(false);
        }
    };
    return (<form onSubmit={handleSubmit} id={formId} className="vault-form vault-sheet-form">
      {credentialLoading && <p role="status" className="vault-editor-status">正在读取凭据…</p>}
      <fieldset className="vault-editor-fields" disabled={loading || credentialLoading || credentialError}>
      {/* 基本信息 - 上层 */}
      <section className="vault-form-basic">
        <div className="vault-form-basic-grid">
          <div className="pf-field">
            <Label htmlFor={`${formId}-name`} className="pf-label">名称</Label>
            <Input id={`${formId}-name`} value={form.name} onChange={(event) => updateField('name', event.target.value)} placeholder="输入凭据名称" required className="pf-input-mono"/>
          </div>

          <div className="pf-field">
            <Label htmlFor={`${formId}-type`} className="pf-label">类型</Label>
            <Select value={form.type} onValueChange={(value) => updateField('type', value as VaultType)} disabled={isEditing}>
              <SelectTrigger id={`${formId}-type`} className="w-full"><SelectValue placeholder="请选择"/></SelectTrigger>
              <SelectContent>{TYPE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          {form.type === 'password' ? (<div className="pf-field">
              <Label htmlFor={`${formId}-username`} className="pf-label">用户名</Label>
              <Input id={`${formId}-username`} value={form.username ?? ''} onChange={(event) => updateField('username', event.target.value)} placeholder="root" required className="pf-input-mono"/>
            </div>) : null}

          <div className="pf-field vault-form-remark">
            <Label htmlFor={`${formId}-remark`} className="pf-label">备注（可选）</Label>
            <Input id={`${formId}-remark`} value={form.remark ?? ''} onChange={(event) => updateField('remark', event.target.value)} placeholder="请输入备注..."/>
          </div>
        </div>
      </section>

      {/* 凭据详情 - 下层 */}
      <div className="vault-form-credential">
        {form.type === 'password' ? (<PasswordEditorSection password={form.password ?? ''} isEditing={isEditing} showGenerator={showGenerator} onPasswordChange={(value) => updateField('password', value)} onToggleGenerator={() => setShowGenerator((current) => !current)} onApplyGeneratedPassword={(password) => {
                updateField('password', password);
                setShowGenerator(false);
            }}/>) : (<>
            <section className="vault-form-key-panel">
              <div className="vault-form-key-head">
                <span className="vault-form-key-title">私钥</span>
                <div className="vault-form-key-actions">
                  <Button type="button" variant="outline" size="icon" onClick={() => setShowPrivateKey((current) => !current)} className="vault-sheet-inline-btn" aria-label={showPrivateKey ? '隐藏私钥' : '显示私钥'}>
                    {showPrivateKey ? <EyeOff size={14}/> : <Eye size={14}/>}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={handleExportPrivateKey} disabled={!form.private_key?.trim()} className="vault-sheet-inline-btn" title="导出私钥文件">
                    <Download size={13}/>
                    导出
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => void pickKeyDocument('private_key')} className="vault-sheet-inline-btn">
                    <Upload size={13}/>
                    导入
                  </Button>
                </div>
              </div>
              <Textarea aria-label="私钥" value={form.private_key ?? ''} onChange={(event) => updateField('private_key', event.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" required rows={6} className={`pf-input-mono pf-key-textarea vault-form-key-textarea ${showPrivateKey ? '' : 'vault-form-key-hidden'}`}/>
              <Input ref={privateKeyFileRef} type="file" accept=".pem,.key,.id_rsa,.id_ed25519" hidden onChange={(event) => {
                const file = event.target.files?.[0];
                if (file)
                    readFile(file, 'private_key');
                event.target.value = '';
            }}/>
            </section>

            <section className="vault-form-key-panel vault-form-key-panel-pub">
              <div className="vault-form-key-head">
                <span className="vault-form-key-title">公钥（可选）</span>
                <div className="vault-form-key-actions">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="outline" size="sm" disabled={!form.public_key?.trim()} className="vault-sheet-inline-btn">
                        <Copy size={13}/>
                        复制
                        <ChevronDown size={12}/>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64">
                        <DropdownMenuItem className="items-start" onSelect={() => void handleCopyPublicKey('content')}>
                          <FileText size={14}/>
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <strong className="text-xs font-semibold">复制公钥内容</strong>
                            <small className="text-[11px] leading-snug text-muted-foreground">复制完整的 OpenSSH 公钥</small>
                          </span>
                        </DropdownMenuItem>
                        <DropdownMenuItem className="items-start" onSelect={() => void handleCopyPublicKey('command')}>
                          <Terminal size={14}/>
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <strong className="text-xs font-semibold">复制公钥导入指令</strong>
                            <small className="text-[11px] leading-snug text-muted-foreground">追加到 authorized_keys</small>
                          </span>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button type="button" variant="outline" size="sm" onClick={() => void pickKeyDocument('public_key')} className="vault-sheet-inline-btn">
                    <Upload size={13}/>
                    导入
                  </Button>
                </div>
              </div>
              <Textarea aria-label="公钥" value={form.public_key ?? ''} onChange={(event) => updateField('public_key', event.target.value)} placeholder="ssh-ed25519 AAAA..." rows={3} className="pf-input-mono pf-key-textarea vault-form-key-textarea vault-form-key-textarea-short"/>
              <Input ref={publicKeyFileRef} type="file" accept=".pub,.txt" hidden onChange={(event) => {
                const file = event.target.files?.[0];
                if (file)
                    readFile(file, 'public_key');
                event.target.value = '';
            }}/>
            </section>

            <div className="vault-form-passphrase-row">
              <div className="pf-field vault-form-passphrase-field">
                <Label htmlFor={`${formId}-passphrase`} className="pf-label">私钥口令（可选）</Label>
                <Input id={`${formId}-passphrase`} type="password" value={form.passphrase ?? ''} onChange={(event) => updateField('passphrase', event.target.value)} placeholder="请输入密码短语..." className="pf-input-mono"/>
              </div>
            </div>
          </>)}
      </div>
      </fieldset>

      <div className="vault-sheet-footer">
        <InlineError message={credentialError ? '读取凭据失败，原有内容已保留。' : error} className="vault-sheet-error"/>
        <div className="vault-sheet-footer-actions">
          {credentialError && <Button type="button" variant="outline" size="sm" onClick={() => setLoadAttempt((value) => value + 1)}>重试</Button>}
          <Button type="button" variant="outline" disabled={loading} onClick={() => onOpenChange(false)} className="pf-btn-cancel">
            取消
          </Button>
          <Button type="submit" form={formId} disabled={!canSubmit} className="pf-btn-submit">
            {loading ? '保存中...' : isEditing ? '保存' : '创建'}
          </Button>
        </div>
      </div>
    </form>);
}
