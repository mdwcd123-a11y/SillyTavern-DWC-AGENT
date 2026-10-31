import { StateStore, validateScope } from './store.mjs';
export const info = { id: 'character-agent', name: 'DWC AGENT', description: 'Versioned private character memory for Sillytavern DWC AGENT V1.0' };
export async function init(router) {
    router.get('/health', (_req, res) => res.json({ ok: true, version: '1.0.0' }));
    const route = handler => async (req, res) => {
        try {
            // Use ST's authenticated user directory. Never accept an arbitrary filesystem root.
            const root = req.user?.directories?.root;
            if (!root) return res.status(401).json({ error: 'Authenticated ST user required' });
            const scope = validateScope(req.body);
            res.json(await handler(new StateStore(root), scope, req.body));
        } catch (error) {
            res.status(error.code === 'ENOENT' ? 404 : 400).json({ error: error.code === 'ENOENT' ? '记忆版本文件不存在；请恢复插件数据备份' : error.message });
        }
    };
    router.post('/state/read', route((store, scope, body) => store.load(scope, body.stateId)));
    router.post('/state/commit', route((store, scope, body) => store.commit(scope, body)));
    console.log('[Character Agent] Private, versioned memory ready. The frontend is disabled by default.');
}
