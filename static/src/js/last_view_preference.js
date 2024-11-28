/** @odoo-module **/

import { registry } from "@web/core/registry";
import { patch } from "@web/core/utils/patch";
import { useService } from "@web/core/utils/hooks";
import { Component, useState } from "@odoo/owl";

// Utility untuk mengelola preferensi
const ViewPreferenceManager = {
    async getPreference(env, model) {
        const orm = env.services.orm;
        try {
            // Use ORM service to fetch preference
            const preference = await orm.call(
                'last.view.preference',
                'get_last_view_for_model',
                [model]
            );
            console.log(`Retrieved preference for ${model}:`, preference);
            return preference;
        } catch (error) {
            console.error('Error getting preference:', error.message, error);
            return null;
        }
    },

    async applyPreference(action, preference) {
        if (!preference?.view_type || !action.views) return false;

        const availableViews = action.views.map(view => view[1]);
        if (!availableViews.includes(preference.view_type)) return false;

        console.log(`Forcing view ${preference.view_type} for ${action.res_model}`);
        action.view_mode = preference.view_type;
        action.views = action.views.filter(view => view[1] === preference.view_type);
        action.preferenceApplied = true;
        return true;
    }
};

// Patch menu service untuk menangkap klik menu
const menuService = registry.category("services").get("menu");
patch(menuService, {
    async onMenuClick(menu) {
        if (!menu.actionID) return super.onMenuClick(menu);

        try {
            const action = await this.env.services.action.loadAction(menu.actionID);
            if (action?.type === 'ir.actions.act_window' && action.res_model) {
                const preference = await ViewPreferenceManager.getPreference(this.env, action.res_model);
                if (preference) {
                    await ViewPreferenceManager.applyPreference(action, preference);
                }
            }
            return this.env.services.action.doAction(action, {
                clearBreadcrumbs: true,
                preferenceApplied: true
            });
        } catch (error) {
            console.error('Error in menu click handler:', error.message, error);
            return super.onMenuClick(menu);
        }
    }
});

// Patch action service untuk memastikan preferensi tidak di-override
const actionService = registry.category("services").get("action");
patch(actionService, {
    async doAction(action, options = {}) {
        // Handle preferences
        if (!options?.preferenceApplied && 
            !action?.preferenceApplied && 
            action?.type === 'ir.actions.act_window' && 
            action.res_model) {
            try {
                const preference = await ViewPreferenceManager.getPreference(this.env, action.res_model);
                ViewPreferenceManager.applyPreference(action, preference);
            } catch (error) {
                console.error('Error applying preference in doAction:', error.message, error);
            }
        }

        // Cleanup viewType properties
        if (options) {
            delete options.viewType;
            delete options.DefaultViewType;
        }
        if (action.context) {
            delete action.context.view_type;
            delete action.context.default_view_type;
        }

        return super.doAction(action, options);
    }
});

// Component untuk mengelola preferensi view
export class LastViewPreference extends Component {
    static template = "DefaultView.LastViewPreference";

    setup() {
        this.orm = useService("orm");
        this.user = useService("user");
        this.state = useState({ isUserAction: false, lastSavedPreference: null });

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
    }

    async _saveCurrentView(force = false) {
        console.log('[ViewPreference] 🔄 Starting save operation:', {
            force,
            isUserAction: this.state.isUserAction
        });

        const actionService = this.env.services.action;
        if (!actionService?.currentController) {
            console.warn('[ViewPreference] ⚠️ No current controller found');
            return;
        }

        const controller = actionService.currentController;
        const viewType = controller.view?.type;
        const model = controller.action?.res_model;
        const actionId = controller.action?.id;

        console.log('[ViewPreference] 📊 Current state:', {
            viewType,
            model,
            actionId,
            controller: controller
        });

        if ((force || this.state.isUserAction) && viewType && model) {
            try {
                console.log('[ViewPreference] 📡 Calling save_last_view with params:', {
                    model,
                    viewType,
                    actionId,
                    userId: this.user.userId
                });

                // Perbarui struktur parameter sesuai dengan method di server
                const params = {
                    model_name: model,
                    view_type: viewType,
                    action_id: actionId,
                    user_id: this.user.userId
                };

                const result = await this.orm.call(
                    'last.view.preference',
                    'save_last_view',
                    [],
                    params
                );

                console.log('[ViewPreference] 💾 Server response:', result);

                // Simpan ke session storage
                this._saveToSessionStorage(model, viewType, actionId);

                // Update state
                this.state.lastSavedPreference = {
                    model,
                    viewType,
                    actionId,
                    timestamp: new Date().getTime()
                };

                console.log('[ViewPreference] ✅ Save operation completed successfully');

            } catch (error) {
                console.error('[ViewPreference] ❌ Save error:', {
                    error,
                    message: error.message,
                    name: error.name,
                    stack: error.stack
                });

                // Simpan error ke session storage untuk debugging
                const errorKey = `view_pref_error_${new Date().getTime()}`;
                sessionStorage.setItem(errorKey, JSON.stringify({
                    error: error.message,
                    stack: error.stack,
                    params: {
                        model,
                        viewType,
                        actionId
                    },
                    timestamp: new Date().toISOString()
                }));

                // Re-throw specific errors untuk handling di level atas
                if (error.message.includes('Access Denied')) {
                    throw new Error('Permission denied when saving view preference');
                }
                if (error.message.includes('Missing required fields')) {
                    throw new Error('Invalid data for saving view preference');
                }
                throw error;
            } finally {
                this.state.isUserAction = false;
                console.log('[ViewPreference] 🏁 Operation completed');
            }
        } else {
            console.log('[ViewPreference] ⏭️ Skipping save operation:', {
                force,
                isUserAction: this.state.isUserAction,
                hasViewType: !!viewType,
                hasModel: !!model
            });
        }
    }

    _saveToSessionStorage(model, viewType, actionId) {
        try {
            const key = `view_pref_${this.user.userId}_${model}`;
            const data = {
                view_type: viewType,
                model_name: model,
                action_id: actionId,
                user_id: this.user.userId,
                timestamp: new Date().toISOString()
            };

            console.log('[ViewPreference] 💾 Saving to session storage:', {
                key,
                data
            });

            sessionStorage.setItem(key, JSON.stringify(data));

            // Verifikasi penyimpanan
            const saved = sessionStorage.getItem(key);
            if (saved) {
                console.log('[ViewPreference] ✅ Session storage verification successful');
            } else {
                console.warn('[ViewPreference] ⚠️ Session storage verification failed');
            }
        } catch (error) {
            console.error('[ViewPreference] ❌ Session storage error:', error);
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
                        console.log(`[ViewPreference] Overriding with: ${preferredView}`);
                        
                        result.view_mode = preferredView;
                        
                        const preferredViewData = result.views.find(v => v[1] === preferredView);
                        const formViewData = result.views.find(v => v[1] === 'form');
                        
                        result.views = [
                            preferredViewData,
                            ...(formViewData ? [formViewData] : [])
                        ];

                        if (result.context && result.context.view_type) {
                            delete result.context.view_type;
                        }

                        console.log("[ViewPreference] Final configuration:", {
                            view_mode: result.view_mode,
                            views: result.views
                        });
                    } else {
                        console.log(`[ViewPreference] Preferred view ${preferredView} not available`);
                    }
                }
            } catch (error) {
                console.warn("[ViewPreference] Error applying preference:", error);
            }
        }
        
        return result;
    },

});

console.log("[ViewPreference] View override initialized");
