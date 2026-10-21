import {beforeEach,expect,it,vi} from 'vitest'
const {api}=vi.hoisted(()=>({api:{createSession:vi.fn(),closeSession:vi.fn(),getSession:vi.fn(),list:vi.fn()}}))
vi.mock('@/api/sftp',()=>({sftpApi:api}))
import {createSftpStore} from './sftp'
import {setWorkspaceGeneration} from '@/lib/workspaceScope'
beforeEach(()=>{vi.resetAllMocks();setWorkspaceGeneration(1);api.closeSession.mockResolvedValue(undefined);api.list.mockImplementation(async(_id,path)=>({path,entries:[]}));api.createSession.mockResolvedValue({session_id:'new',status:'connected',home_dir:'/home'})})
it('刷新失联会话会重新连接并恢复原目录',async()=>{
 const store=createSftpStore();const tab=store.getState().leftTabs[0];store.setState({leftTabs:[{...tab,sessionId:'old',path:'/work'}]});api.getSession.mockResolvedValue({status:'disconnected'});await store.getState().refresh('left');expect(api.closeSession).toHaveBeenCalledWith('old');expect(api.createSession).toHaveBeenCalledWith('local');expect(store.getState().leftTabs[0]).toMatchObject({sessionId:'new',path:'/work',error:null});expect(api.list).toHaveBeenLastCalledWith('new','/work',false)
})
it('切换标签后旧目录响应只更新所属标签',async()=>{
 const store=createSftpStore(),first=store.getState().leftTabs[0],second={...first,id:'second',sessionId:'two',path:'/two'};store.setState({leftTabs:[{...first,sessionId:'one'},second]});let resolve!:(value:{path:string;entries:[]})=>void;api.list.mockReturnValue(new Promise(r=>{resolve=r}));const pending=store.getState().navigate('left','/new');store.getState().setActiveTab('left','second');resolve({path:'/new',entries:[]});await pending;expect(store.getState().activeLeftTabId).toBe('second');expect(store.getState().leftTabs[1].path).toBe('/two');expect(store.getState().leftTabs[0]).toMatchObject({path:'/new',loading:false})
})
it('旧空间的视图不能发起新连接',async()=>{
 const store=createSftpStore();setWorkspaceGeneration(2);await store.getState().connectServer('left',store.getState().leftTabs[0].server);await store.getState().refresh('left');expect(api.createSession).not.toHaveBeenCalled();expect(api.getSession).not.toHaveBeenCalled()
})
