/** @odoo-module **/
import { registry } from "@web/core/registry";
import { patch } from "@web/core/utils/patch";
import { useService } from "@web/core/utils/hooks";
import { Component, useState } from "@odoo/owl";

// Component for managing view preferences
export class LastViewPreference extends Component {
    static template = "DefaultView.LastViewPreference";

    setup() {
        // Initialize services
        this.orm = useService("orm");
        this.user = useService("user");
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
            
            // Wait briefly to ensure the controller is available
            if (!actionService?.currentController) {
                console.log('[ViewPreference] ⏳ Waiting for controller...');
                await new Promise(resolve => setTimeout(resolve, 100));
                
                if (!actionService?.currentController) {
                    console.log('[ViewPreference] ⚠️ Still no controller available, skipping save');
                    return;
                }
            }

            const controller = actionService.currentController;
            
            // Validate necessary data
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