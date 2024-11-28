/** @odoo-module **/
import { _t } from "@web/core/l10n/translation";
import { registry } from "@web/core/registry";
import { patch } from "@web/core/utils/patch";
import { useService } from "@web/core/utils/hooks";
import { Component, useState } from "@odoo/owl";

// Utility untuk mengelola preferensi
const ViewPreferenceManager = {
    async getPreference(env, model) {
        const orm = env.services.orm;
        try {
            const preference = await orm.call(
                'last.view.preference',
                'get_last_view_for_model',
                [model]
            );
            console.log(`[ViewPreference] 🔍 Retrieved preference for ${model}:`, preference);
            
            // Normalize view type (handle both 'list' and 'tree')
            if (preference?.view_type === 'tree') {
                preference.view_type = 'list';
            }
            
            return preference;
        } catch (error) {
            console.error('[ViewPreference] ❌ Error getting preference:', error.message, error);
            return null;
        }
    },

    async applyPreference(action, preference) {
        if (!preference?.view_type || !action.views) return false;

        console.log('[ViewPreference] 🚀 Starting preference application:', {
            preferredView: preference.view_type,
            currentViews: action.views.map(v => v[1]),
            actionModel: action.res_model
        });

        // Normalize the preferred view type
        let normalizedViewType = preference.view_type;
        if (normalizedViewType === 'tree') normalizedViewType = 'list';

        // Find available views
        const hasListView = action.views.some(v => v[1] === 'list');
        const hasTreeView = action.views.some(v => v[1] === 'tree');
        
        // Convert all tree views to list views
        action.views = action.views.map(view => {
            return view[1] === 'tree' ? [view[0], 'list'] : view;
        });

        // Force view configuration for list/tree
        if (normalizedViewType === 'list') {
            if (!hasListView && !hasTreeView) {
                console.log('[ViewPreference] ⚠️ No list/tree view available');
                return false;
            }

            // Force list view mode
            action.view_mode = 'list';
            
            // Find the list view data
            const listViewData = action.views.find(v => v[1] === 'list');
            const formViewData = action.views.find(v => v[1] === 'form');
            const otherViews = action.views.filter(v => 
                v[1] !== 'list' && v[1] !== 'form'
            );

            // Reconstruct views array with list view first
            action.views = [
                listViewData,
                ...(formViewData ? [formViewData] : []),
                ...otherViews
            ];

            // Force context
            action.context = {
                ...(action.context || {}),
                view_type: 'list'
            };
        } else {
            // Handle other view types normally
            action.view_mode = normalizedViewType;
            const preferredViewData = action.views.find(v => v[1] === normalizedViewType);
            const formViewData = action.views.find(v => v[1] === 'form');
            const otherViews = action.views.filter(v => 
                v[1] !== normalizedViewType && v[1] !== 'form'
            );

            action.views = [
                preferredViewData,
                ...(formViewData ? [formViewData] : []),
                ...otherViews
            ];
        }

        // Ensure view_mode matches the first view
        action.view_mode = action.views[0][1];
        
        // Clean up any conflicting settings
        if (action.context) {
            delete action.context.default_view_type;
        }

        console.log('[ViewPreference] ✅ Final action config:', {
            view_mode: action.view_mode,
            views: action.views.map(v => v[1]),
            context: action.context
        });

        return true;
    }
};

// Patch menu service untuk menangkap klik menu
const menuService = registry.category("services").get("menu");
patch(menuService, {
    async onMenuClick(menu) {
        if (!menu.actionID) return super.onMenuClick(menu);

        try {
            // 1. Load action dan preference secara parallel untuk optimasi
            const [action, preference] = await Promise.all([
                this.env.services.action.loadAction(menu.actionID),
                ViewPreferenceManager.getPreference(this.env, action?.res_model)
            ]);

            if (action?.type === 'ir.actions.act_window' && action.res_model) {
                // 2. Terapkan preferensi langsung ke action
                const normalizedViewType = preference?.view_type === 'tree' ? 'list' : preference?.view_type;
                
                if (normalizedViewType && action.views) {
                    // 3. Reorder views dengan view yang diinginkan di posisi pertama
                    const preferredViewIndex = action.views.findIndex(v => 
                        v[1] === normalizedViewType || 
                        (normalizedViewType === 'list' && v[1] === 'tree')
                    );

                    if (preferredViewIndex !== -1) {
                        // Extract dan pindahkan view yang dipilih ke depan
                        const [selectedView] = action.views.splice(preferredViewIndex, 1);
                        action.views = [selectedView, ...action.views];
                        
                        // Update konfigurasi action
                        action.view_type = normalizedViewType;
                        action.view_mode = action.views.map(v => v[1]).join(',');
                        
                        // Force context
                        action.context = {
                            ...(action.context || {}),
                            view_type: normalizedViewType,
                            force_view_type: normalizedViewType,
                            initial_view: normalizedViewType,
                            preferred_view: normalizedViewType // tambahan flag
                        };

                        console.log('[ViewPreference] 🚀 Direct view application:', {
                            model: action.res_model,
                            view: normalizedViewType,
                            views: action.views.map(v => v[1])
                        });
                    }
                }
            }

            // 4. Jalankan action dengan flag khusus
            return this.env.services.action.doAction(action, {
                clearBreadcrumbs: true,
                preferenceApplied: true,
                forceView: preference?.view_type,
                additionalContext: {
                    force_initial_view: preference?.view_type
                }
            });

        } catch (error) {
            console.error('[ViewPreference] Error in menu click:', error);
            return super.onMenuClick(menu);
        }
    }
});

// Tambahkan utility function untuk normalisasi view
const ViewPreferenceUtils = {
    normalizeViewType(viewType) {
        return viewType === 'tree' ? 'list' : viewType;
    },
    
    isListView(viewType) {
        return viewType === 'list' || viewType === 'tree';
    }
};

// Patch action service untuk memastikan view preference diterapkan
const actionService = registry.category("services").get("action");
patch(actionService, {
    async doAction(actionRequest, options = {}) {
        if (actionRequest.type === 'ir.actions.act_window' && 
            actionRequest.context?.preferred_view) {
            
            // Pastikan view preference tetap terjaga
            const preferredView = actionRequest.context.preferred_view;
            
            // Override options untuk memaksa view
            options = {
                ...options,
                viewType: preferredView,
                forceView: true
            };
        }
        
        return super.doAction(actionRequest, options);
    },

    async switchView(viewType, props = {}) {
        // Normalize view type
        const normalizedViewType = viewType === 'tree' ? 'list' : viewType;
        
        if (this.currentController?.action) {
            const action = this.currentController.action;
            
            // Update views order
            const viewIndex = action.views.findIndex(v => 
                v[1] === normalizedViewType || 
                (normalizedViewType === 'list' && v[1] === 'tree')
            );
            
            if (viewIndex !== -1) {
                const [selectedView] = action.views.splice(viewIndex, 1);
                action.views = [selectedView, ...action.views];
                action.view_mode = action.views.map(v => v[1]).join(',');
            }
        }
        
        return super.switchView(normalizedViewType, props);
    }
});

// Component untuk mengelola preferensi view
export class LastViewPreference extends Component {
    static template = "DefaultView.LastViewPreference";

    setup() {
        // Initialize services
        this.orm = useService("orm");
        this.user = useService("user");
        this.action = useService("action");
        
        this.state = useState({ 
            isUserAction: false, 
            lastSavedPreference: null 
        });

        // Setup event listeners
        this.env.bus.addEventListener('ACTION_MANAGER:UI-UPDATED', async () => {
            if (this.state.isUserAction) await this._saveCurrentView();
        });

        this.env.bus.addEventListener('VIEW_SWITCHER:CLICK', async () => {
            this.state.isUserAction = true;
            await this._saveCurrentView();
        });

        this.env.bus.addEventListener('USER_LOGOUT', async () => {
            if (this.state.lastSavedPreference) await this._saveCurrentView(true);
        });

        this.env.bus.addEventListener('ACTION_MANAGER:UPDATE', async () => {
            await this._saveCurrentView(true);
        });

        console.log('[ViewPreference] 🔧 Component setup completed');
    }

    async _saveCurrentView(force = false) {
        console.log('[ViewPreference] 🔄 Starting save operation');
        
        try {
            const actionService = this.env.services.action;
            
            // Tunggu sebentar untuk memastikan controller sudah tersedia
            if (!actionService?.currentController) {
                console.log('[ViewPreference] ⏳ Waiting for controller...');
                // Tunggu 100ms dan coba lagi
                await new Promise(resolve => setTimeout(resolve, 100));
                
                // Cek lagi setelah menunggu
                if (!actionService?.currentController) {
                    console.log('[ViewPreference] ⚠️ Still no controller available, skipping save');
                    return;
                }
            }

            const controller = actionService.currentController;
            
            // Validasi data yang diperlukan
            if (!controller.action?.res_model || !controller.view?.type) {
                console.log('[ViewPreference] ⚠️ Incomplete controller data:', {
                    hasModel: !!controller.action?.res_model,
                    hasViewType: !!controller.view?.type
                });
                return;
            }

            const viewType = controller.view.type;
            const model = controller.action.res_model;
            const actionId = controller.action.id;
            const actionName = controller.action.name || controller.action.display_name;

            console.log('[ViewPreference] 📊 Current state:', {
                viewType,
                model,
                actionId,
                actionName
            });

            if ((force || this.state.isUserAction) && viewType && model && actionId) {
                try {
                    console.log('[ViewPreference] 📡 Calling save_last_view with:', {
                        model,
                        viewType,
                        actionId,
                        actionName
                    });

                    const result = await this.orm.call(
                        'last.view.preference',
                        'save_last_view',
                        [model, viewType, actionId, actionName]
                    );

                    console.log('[ViewPreference] 💾 Server response:', result);

                    if (result) {
                        // Save to session storage
                        const sessionKey = `view_pref_${this.user.userId}_${model}_${actionId}`;
                        const sessionData = {
                            model_name: model,
                            view_type: viewType,
                            action_id: actionId,
                            action_name: actionName,
                            timestamp: new Date().toISOString()
                        };
                        
                        sessionStorage.setItem(sessionKey, JSON.stringify(sessionData));
                        
                        console.log('[ViewPreference] 💾 Saved to session storage:', {
                            key: sessionKey,
                            data: sessionData
                        });
                    }

                } catch (error) {
                    console.error('[ViewPreference] ❌ Error:', error);
                } finally {
                    this.state.isUserAction = false;
                }
            } else {
                console.log('[ViewPreference] ⏭️ Skipping save:', {
                    force,
                    isUserAction: this.state.isUserAction,
                    hasViewType: !!viewType,
                    hasModel: !!model,
                    hasActionId: !!actionId,
                    hasActionName: !!actionName
                });
            }
        } catch (error) {
            console.error('[ViewPreference] ❌ Error in _saveCurrentView:', error);
        }
    }
}

// Register component
registry.category("main_components").add("LastViewPreference", {
    Component: LastViewPreference,
});

console.log("[ViewPreference] Initializing view loading override...");

async function getViewPreference(env, model) {
    const orm = env.services.orm;

    try {
        // Check database first
        const prefs = await orm.searchRead(
            'last.view.preference',
            [['user_id', '=', env.session.uid], ['model_name', '=', model]],
            ['view_type'],
            { limit: 1, order: 'write_date DESC' }
        );

        if (prefs?.length && prefs[0].view_type) {
            console.log("[ViewPreference] Using DB preference:", prefs[0].view_type);
            return prefs[0].view_type;
        }

        // Fallback to session storage
        const key = `view_pref_${env.session.uid}_${model}`;
        const stored = sessionStorage.getItem(key);
        if (stored) {
            const preference = JSON.parse(stored);
            console.log("[ViewPreference] Using session preference:", preference.view_type);
            return preference.view_type;
        }
    } catch (error) {
        console.warn("[ViewPreference] Error getting preference:", error);
    }

    return null;
}

patch(actionService, {
    async loadAction(actionId, context = {}, options = {}) {
        const result = await super.loadAction(actionId, context, options);
        
        if (result.type === 'ir.actions.act_window' && 
            result.res_model && 
            !result.res_model.startsWith('ir.')) {
            
            console.log("[ViewPreference] Processing action:", {
                model: result.res_model,
                currentViews: result.views,
                currentViewMode: result.view_mode
            });

            try {
                const preferredView = await getViewPreference(this.env, result.res_model);
                
                if (preferredView && result.views) {
                    const availableViews = result.views.map(v => v[1]);
                    if (availableViews.includes(preferredView)) {
                        console.log(`[ViewPreference] 🔄 Applying preferred view: ${preferredView}`);
                        
                        // Set initial view mode
                        result.view_mode = preferredView;
                        
                        // Reorganize views
                        const preferredViewData = result.views.find(v => v[1] === preferredView);
                        const formViewData = result.views.find(v => v[1] === 'form');
                        const otherViews = result.views.filter(v => 
                            v[1] !== preferredView && v[1] !== 'form'
                        );

                        // Reconstruct views array
                        result.views = [
                            preferredViewData,
                            ...(formViewData ? [formViewData] : []),
                            ...otherViews
                        ];

                        // Update view_mode to include all views
                        result.view_mode = result.views.map(v => v[1]).join(',');

                        // Clean up any existing view type in context
                        if (result.context) {
                            delete result.context.view_type;
                            delete result.context.default_view_type;
                        }

                        console.log("[ViewPreference] ✅ Final configuration:", {
                            view_mode: result.view_mode,
                            views: result.views.map(v => v[1])
                        });
                    } else {
                        console.log(`[ViewPreference] ⚠️ Preferred view ${preferredView} not available`);
                    }
                }
            } catch (error) {
                console.warn("[ViewPreference] ❌ Error applying preference:", error);
            }
        }
        
        return result;
    }
});

console.log("[ViewPreference] View override initialized");
