import { Loading } from '@/components/ui/loading'
import { ItemSyncBadge } from '@/components/SyncIndicator';
import { useState,useMemo,useEffect,useRef,type ReactNode } from 'react';
import { Plus,Edit,Trash2,Server,FolderPlus,FolderEdit,ChevronDown } from 'lucide-react';
import { ProfileForm } from '@/components/ProfileForm';
import { GroupForm } from '@/components/Sidebar/GroupForm';
import { useProfileStore } from '@/store/profile';
import { useSessionStore } from '@/store/session';
import { useDesktopShellStore } from '@/store/desktopShell';
import { ShellIconButton } from '@/components/Layout/ShellControls';
import { DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { resolveServerIcon } from '@/lib/serverIcons';
import { resolveGroupIcon } from '@/lib/groupIcons';
import { usePointerDrag } from '@/hooks/usePointerDrag';
import { dropPayloadAttr } from '@/lib/dragRegistry';
import { SftpContextMenu } from '@/components/Sftp/SftpContextMenu';
import { Button } from '@/components/ui/button';
import { Tooltip,TooltipContent,TooltipTrigger } from '@/components/ui/tooltip';
import { AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle,} from '@/components/ui/alert-dialog';
import type { Profile } from '@/types/profile';
import type { Group } from '@/types/group';
const UNGROUPED_ID = '__ungrouped__';
export function Sidebar({ collapsed = false, onToggle, onAddServer }: {
    visible?: boolean;
    collapsed?: boolean;
    onToggle?: () => void;
    onAddServer?: () => void;
}) {
    const { collapsedGroups, toggleGroup } = useDesktopShellStore();
    const { profiles: rawProfiles, groups: rawGroups, searchQuery, loading, deleteProfile, deleteGroup, updateProfile, } = useProfileStore();
    const profiles = useMemo(() => rawProfiles ?? [], [rawProfiles]);
    const groups = useMemo(() => rawGroups ?? [], [rawGroups]);
    const { openTab, tabs, activeTabId } = useSessionStore();
    // Profile form
    const [showProfileForm, setShowProfileForm] = useState(false);
    const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
    // Group form
    const [showGroupForm, setShowGroupForm] = useState(false);
    const [editingGroup, setEditingGroup] = useState<Group | null>(null);
    const [groupFormParent, setGroupFormParent] = useState<string>('');
    const [profileToDelete, setProfileToDelete] = useState<Profile | null>(null);
    const [groupToDelete, setGroupToDelete] = useState<Group | null>(null);
    // Context menus
    const [profileMenu, setProfileMenu] = useState<{
        x: number;
        y: number;
        profile: Profile;
    } | null>(null);
    const [groupMenu, setGroupMenu] = useState<{
        x: number;
        y: number;
        group: Group;
    } | null>(null);
    const [blankMenu, setBlankMenu] = useState<{
        x: number;
        y: number;
    } | null>(null);
    // Drag-and-drop
    const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
    // ─── 指针拖拽（替代 HTML5 DnD，服务器拖入分组） ──────────────────────────
    const profilesRef = useRef({ profiles, groups });
    useEffect(() => {
        profilesRef.current = { profiles, groups };
    });
    const moveProfileToGroup = async (profileId: string, targetGid: string) => {
        const { profiles: currentProfiles, groups: currentGroups } = profilesRef.current;
        const targetGroupId = targetGid === UNGROUPED_ID ? '' : targetGid;
        const profile = currentProfiles.find((p) => p.id === profileId);
        if (!profile)
            return;
        if ((profile.group_id || '') === targetGroupId)
            return; // same group, no-op
        try {
            await updateProfile(profileId, { group_id: targetGroupId });
            const label = targetGroupId
                ? currentGroups.find((g) => g.id === targetGroupId)?.name || '分组'
                : '服务器管理';
            toast.success(`已移动到「${label}」`);
        }
        catch (err) {
            toast.error((err as Error).message || '移动失败');
        }
    };
    const serverDrag = usePointerDrag<{
        profileId: string;
        name: string;
    }>({
        ghostLabel: (session) => session.name,
        onActivate: () => { },
        onOver: (_session, payload) => {
            const groupId = payload?.kind === 'group' ? payload.groupId : null;
            setDragOverGroupId((current) => (current === groupId ? current : groupId));
        },
        onDrop: (session, payload) => {
            if (payload.kind !== 'group')
                return;
            setDragOverGroupId(null);
            void moveProfileToGroup(session.profileId, payload.groupId);
        },
        onCancel: () => setDragOverGroupId(null),
    });
    // Click-to-select on the server list (single click selects, double connects).
    const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
    const activeTab = tabs.find((t) => t.id === activeTabId);
    const activeProfileId = useMemo(() => {
        const tab = tabs.find((t) => t.id === activeTabId);
        return tab?.profileId;
    }, [tabs, activeTabId]);
    const handleConnect = (profile: Profile) => {
        const shouldReuseActiveDraft = activeTab &&
            !activeTab.profileId &&
            !activeTab.sessionId;
        openTab(profile.id, profile.name, profile.host, profile.port, profile.username, shouldReuseActiveDraft ? activeTab.id : undefined);
    };
    const handleEditProfile = (profile: Profile) => {
        setEditingProfile(profile);
        setShowProfileForm(true);
        setProfileMenu(null);
    };
    const handleDeleteProfile = (profile: Profile) => {
        setProfileToDelete(profile);
        setProfileMenu(null);
    };
    const confirmDeleteProfile = async () => {
        if (!profileToDelete)
            return;
        try {
            await deleteProfile(profileToDelete.id);
            toast.success('连接已删除');
        }
        catch (err) {
            toast.error((err as Error).message || '删除失败');
        }
        finally {
            setProfileToDelete(null);
        }
    };
    const handleProfileContextMenu = (e: React.MouseEvent, profile: Profile) => {
        e.preventDefault();
        e.stopPropagation();
        setProfileMenu({ x: e.clientX, y: e.clientY, profile });
    };
    // New servers always default to no group (ungrouped). Grouping is done
    // afterwards via drag-and-drop or manual selection in the form.
    const handleAddServer = () => {
        if (onAddServer) {
            onAddServer();
            setBlankMenu(null);
            return;
        }
        setEditingProfile(null);
        setShowProfileForm(true);
        setBlankMenu(null);
    };
    // Group CRUD
    const handleAddGroup = (parentId?: string) => {
        setEditingGroup(null);
        setGroupFormParent(parentId ?? '');
        setShowGroupForm(true);
        setGroupMenu(null);
        setBlankMenu(null);
    };
    const handleEditGroup = (group: Group) => {
        setEditingGroup(group);
        setGroupFormParent('');
        setShowGroupForm(true);
        setGroupMenu(null);
    };
    const handleDeleteGroup = (group: Group) => {
        setGroupMenu(null);
        // Front-end guard: backend also enforces 409, but this gives instant UX.
        const count = profiles.filter((p) => p.group_id === group.id).length;
        if (count > 0) {
            toast.warning(`该分组下仍有 ${count} 台服务器，请先移动或删除后再删除分组`);
            return;
        }
        setGroupToDelete(group);
    };
    const confirmDeleteGroup = async () => {
        if (!groupToDelete)
            return;
        try {
            await deleteGroup(groupToDelete.id);
            toast.success('分组已删除');
        }
        catch (err) {
            toast.error((err as Error).message || '删除失败');
        }
        finally {
            setGroupToDelete(null);
        }
    };
    const handleGroupContextMenu = (e: React.MouseEvent, group: Group) => {
        e.preventDefault();
        e.stopPropagation();
        setGroupMenu({ x: e.clientX, y: e.clientY, group });
    };
    // Blank-area context menu (right-click on empty sidebar space).
    const handleBlankContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        setBlankMenu({ x: e.clientX, y: e.clientY });
    };
    // 旧 HTML5 分组拖放已被上方指针拖拽（serverDrag）取代
    // Group profiles by their group; ungrouped go to "服务器管理"
    // Split servers into those belonging to a real group vs. loose (no group).
    // Groups render first (folder-like, higher priority); loose servers render
    // last, like files outside any folder.
    const serversByGroup = useMemo(() => {
        const map: Record<string, Profile[]> = {};
        groups.forEach((g) => { map[g.id] = []; });
        profiles.forEach((p) => {
            if (p.group_id && map[p.group_id] !== undefined)
                map[p.group_id].push(p);
        });
        return map;
    }, [profiles, groups]);
    const looseServers = useMemo(() => profiles.filter((p) => !p.group_id || !groups.some((g) => g.id === p.group_id)), [profiles, groups]);
    const renderServerRow = (profile: Profile) => {
        const isSelected = profile.id === selectedProfileId;
        const isActive = profile.id === activeProfileId;
        const tab = tabs.find((t) => t.profileId === profile.id && t.status === 'connected') ?? tabs.find((t) => t.profileId === profile.id);
        const status = tab?.status ?? 'disconnected';
        const Icon = resolveServerIcon(profile.icon);
        const meta = profile.port && profile.port !== 22
            ? `${profile.username}@${profile.host}:${profile.port}`
            : `${profile.username}@${profile.host}`;
        return (<Tooltip key={profile.id}>
    <TooltipTrigger asChild>
    <div key={profile.id} className={`srv ${status === 'disconnected' ? 'offline' : ''} ${isSelected || isActive ? 'active' : ''}`} role="button" tabIndex={0} title={`${profile.name} · ${meta}`} onPointerDown={(e) => { if (!(e.target as HTMLElement).closest('button'))
            serverDrag.start(e, { profileId: profile.id, name: profile.name }); }} onClick={(e) => {
                e.stopPropagation();
                setSelectedProfileId(profile.id);
            }} onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('button'))
            handleConnect(profile); }} onContextMenu={(e) => handleProfileContextMenu(e, profile)} onKeyDown={(e) => {
                if ((e.target as HTMLElement).closest('button'))
                    return;
                if (e.key === 'Enter') {
                    e.preventDefault();
                    handleConnect(profile);
                }
                if (e.key === ' ') {
                    e.preventDefault();
                    setSelectedProfileId(profile.id);
                }
            }}>
        <div className="srv-icon">
          <Icon size={14}/>
        </div>
        <div className="srv-info">
          <span className="srv-nm">{profile.name}<ItemSyncBadge type="profile" id={profile.id}/></span>
          <span className={`shell-connection-dot is-${status}`} aria-label={status === 'connected' ? '已连接' : status === 'connecting' || status === 'reconnecting' ? '连接中' : '未连接'}/>
        </div>
        <Button type="button" variant="ghost" size="icon-xs" className="srv-edit-btn" title="编辑服务器" aria-label="编辑服务器" onClick={(e) => {
                e.stopPropagation();
                handleEditProfile(profile);
            }}>
          <Edit size={12}/>
        </Button>
      </div>
    </TooltipTrigger>
    <TooltipContent side="right" sideOffset={8}>{profile.name} · {meta}</TooltipContent>
    </Tooltip>);
    };
    const renderGroup = (group: Group, ancestors: string[] = []): ReactNode => {
        if (ancestors.includes(group.id))
            return null;
        const list = serversByGroup[group.id] ?? [];
        const children = groups.filter((g) => g.parent_id === group.id);
        const Icon = resolveGroupIcon(group.icon);
        const folded = Boolean(collapsedGroups[group.id]);
        return <div className={`srv-group ${dragOverGroupId === group.id ? 'grp-drop-target' : ''}`} key={group.id} data-drag-payload={dropPayloadAttr({ kind: 'group', groupId: group.id })}>
      <div className="grp-label" role="button" tabIndex={0} aria-expanded={!folded} onClick={() => toggleGroup(group.id)} onKeyDown={(event) => {
                if ((event.target as HTMLElement).closest('button'))
                    return;
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggleGroup(group.id);
                }
            }} onContextMenu={(event) => handleGroupContextMenu(event, group)}>
        <span className="grp-label-left"><ChevronDown size={12} className={folded ? 'is-collapsed' : ''}/><Icon size={13} className="grp-label-icon"/>
          <span className="grp-label-text">{group.name}<ItemSyncBadge type="group" id={group.id}/></span><span className="grp-cnt">{list.length}</span>
        </span>
      </div>
      {!folded && <>{list.map(renderServerRow)}{children.length > 0 && <div className="shell-child-groups">{children.map((child) => renderGroup(child, [...ancestors, group.id]))}</div>}</>}
    </div>;
    };
    return (<div className="shell-server-list">
      <div className="shell-section-heading">
        <Button variant="ghost" className="shell-section-toggle" aria-expanded={!collapsed} onClick={onToggle}>
          <ChevronDown className={collapsed ? 'is-collapsed' : ''} size={12}/><span>服务器</span><span className="shell-count">{profiles.length}</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><ShellIconButton label="新增服务器或分组"><Plus size={15}/></ShellIconButton></DropdownMenuTrigger>
          <DropdownMenuContent data-sidebar-popover align="end">
            <DropdownMenuItem onSelect={handleAddServer}><Server />新增服务器</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => handleAddGroup('')}><FolderPlus />新建分组</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
          <div className="sidebar-body" hidden={collapsed} inert={collapsed} onContextMenu={handleBlankContextMenu} onClick={() => setSelectedProfileId(null)}>
            {loading ? (<Loading />) : profiles.length === 0 && groups.length === 0 ? (<div className="sidebar-empty">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
                  <circle cx="7" cy="7" r="4.5"/>
                  <line x1="10.2" y1="10.2" x2="14" y2="14"/>
                </svg>
                <span>{searchQuery ? `没有匹配 "${searchQuery}" 的服务器` : '暂无连接'}</span>
              </div>) : (<>
                {/* Groups (folders) — render first, higher priority than loose servers */}
                {groups.filter((g) => !g.parent_id || !groups.some((parent) => parent.id === g.parent_id)).map((group) => renderGroup(group))}

                {/* Loose servers (no group) — render last, like files outside folders */}
                {looseServers.length > 0 && (<div className={`srv-group ${dragOverGroupId === UNGROUPED_ID ? 'grp-drop-target' : ''}`} data-drag-payload={dropPayloadAttr({ kind: 'group', groupId: UNGROUPED_ID })}>
                    {groups.length > 0 && (<div className="grp-label">
                        <span className="grp-label-left">
                          <span className="grp-label-text grp-label-muted">未分组</span>
                          <span className="grp-cnt">{looseServers.length}</span>
                        </span>
                      </div>)}
                    {looseServers.map(renderServerRow)}
                  </div>)}
              </>)}
          </div>
      {/* Profile context menu */}
      {profileMenu && (<SftpContextMenu sidebarPopover x={profileMenu.x} y={profileMenu.y} onClose={() => setProfileMenu(null)} items={[
                { id: 'connect', label: '连接', icon: <Server size={13}/>, onClick: () => handleConnect(profileMenu.profile) },
                { id: 'edit', label: '编辑', icon: <Edit size={13}/>, onClick: () => handleEditProfile(profileMenu.profile) },
                { id: 'divider-delete', label: '', divider: true },
                { id: 'delete', label: '删除', icon: <Trash2 size={13}/>, danger: true, onClick: () => void handleDeleteProfile(profileMenu.profile) },
            ]}/>)}

      {/* Group context menu */}
      {groupMenu && (<SftpContextMenu sidebarPopover x={groupMenu.x} y={groupMenu.y} onClose={() => setGroupMenu(null)} items={[
                { id: 'add-child', label: '新建子分组', icon: <FolderPlus size={13}/>, onClick: () => handleAddGroup(groupMenu.group.id) },
                { id: 'edit', label: '编辑分组', icon: <FolderEdit size={13}/>, onClick: () => handleEditGroup(groupMenu.group) },
                { id: 'divider-delete', label: '', divider: true },
                { id: 'delete', label: '删除分组', icon: <Trash2 size={13}/>, danger: true, onClick: () => void handleDeleteGroup(groupMenu.group) },
            ]}/>)}

      {/* Blank-area context menu */}
      {blankMenu && (<SftpContextMenu sidebarPopover x={blankMenu.x} y={blankMenu.y} onClose={() => setBlankMenu(null)} items={[
                { id: 'add-server', label: '新建服务器', icon: <Server size={13}/>, onClick: handleAddServer },
                { id: 'add-group', label: '新建分组', icon: <FolderPlus size={13}/>, onClick: () => handleAddGroup('') },
            ]}/>)}

      {/* Profile form dialog */}
      <ProfileForm key={showProfileForm ? `profile-${editingProfile?.id || 'new'}` : 'profile-closed'} open={showProfileForm} onOpenChange={setShowProfileForm} profile={editingProfile}/>

      {/* Group form dialog */}
      <GroupForm key={showGroupForm ? `group-${editingGroup?.id || `new-${groupFormParent}`}` : 'group-closed'} open={showGroupForm} onOpenChange={setShowGroupForm} group={editingGroup} defaultParentId={groupFormParent}/>

      <AlertDialog open={profileToDelete !== null} onOpenChange={(open) => !open && setProfileToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除连接？</AlertDialogTitle>
            <AlertDialogDescription>确定删除连接「{profileToDelete?.name}」？此操作无法撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => void confirmDeleteProfile()}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={groupToDelete !== null} onOpenChange={(open) => !open && setGroupToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除分组？</AlertDialogTitle>
            <AlertDialogDescription>确定删除分组「{groupToDelete?.name}」？此操作无法撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => void confirmDeleteGroup()}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>);
}
