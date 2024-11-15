/** @odoo-module **/

import { registry } from "@web/core/registry";
import { patch } from "@web/core/utils/patch";
import { useService } from "@web/core/utils/hooks";
import { Component } from "@odoo/owl";

class LastViewPreference extends Component {
    setup() {
        console.log('LastViewPreference component setup initialized');
        this.orm = useService("orm");
        this.rpc = useService("rpc");
        this.notification = useService("notification");
        this.action = useService("action");
        
        // Listen for view changes
        this.env.bus.addEventListener('ACTION_MANAGER:UI-UPDATED', () => {
            console.log('View change detected');
            this.saveCurrentView();
        });
    }

    async saveCurrentView() {
        const actionService = this.env.services.action;
        
        if (!actionService?.currentController) {
            console.log('No current controller found');
            return;
        }

        const controller = actionService.currentController;
        const viewType = controller.view?.type;
        const model = controller.action?.res_model;

        console.log('Current view details:', {
            viewType: viewType,
            model: model,
            controller: controller
        });

        if (viewType && model) {
            try {
                // Kirim arguments sebagai array tunggal
                const result = await this.orm.call(
                    'last.view.preference',
                    'save_last_view',
                    [model, viewType]  // Kirim sebagai array tunggal
                );

                if (result) {
                    // Update local storage
                    const data = {
                        model_name: model,
                        view_type: viewType,
                        timestamp: new Date().toISOString()
                    };
                    sessionStorage.setItem(`view_preference_${model}`, JSON.stringify(data));
                    
                    this.notification.add(`View preference saved: ${viewType}`, {
                        type: 'success',
                        sticky: false
                    });
                }
            } catch (error) {
                console.error('Error saving view preference:', error);
                this.notification.add('Error saving view preference', {
                    type: 'danger',
                    sticky: true
                });
            }
        }
    }

    async loadViewPreference(model) {
        console.log(`Loading view preference for model: ${model}`);
        
        try {
            // 1. Coba ambil dari sessionStorage (paling cepat)
            const sessionData = sessionStorage.getItem(`view_preference_${model}`);
            if (sessionData) {
                const preference = JSON.parse(sessionData);
                console.log('Found in sessionStorage:', preference);
                return preference.view_type;
            }

            // 2. Coba ambil dari localStorage
            const localData = localStorage.getItem(`view_preference_${model}`);
            if (localData) {
                const preference = JSON.parse(localData);
                console.log('Found in localStorage:', preference);
                return preference.view_type;
            }

            // 3. Coba ambil dari database
            const dbPreference = await this.orm.call(
                'last.view.preference',
                'get_last_view_for_model',
                [model]
            );

            if (dbPreference?.view_type) {
                console.log('Found in database:', dbPreference);
                
                // Update storage lokal dengan data dari database
                const preferenceData = {
                    model_name: model,
                    view_type: dbPreference.view_type,
                    timestamp: new Date().toISOString()
                };

                sessionStorage.setItem(
                    `view_preference_${model}`, 
                    JSON.stringify(preferenceData)
                );
                localStorage.setItem(
                    `view_preference_${model}`, 
                    JSON.stringify(preferenceData)
                );

                return dbPreference.view_type;
            }

            console.log('No view preference found in any storage');
            return false;

        } catch (error) {
            console.error('Error loading view preference:', error);
            console.error('Error details:', {
                message: error.message,
                stack: error.stack
            });
            return false;
        }
    }


}

LastViewPreference.template = "last_view_preference.LastViewPreference";

// Register the component
registry.category("main_components").add("LastViewPreference", {
    Component: LastViewPreference,
    debug: true
});

// Patch action service
const actionService = registry.category("services").get("action");
patch(actionService, {
    async doAction(action, options = {}) {
        console.log('doAction called with:', { 
            actionType: action?.type,
            model: action?.res_model,
            views: action?.views,
            currentOptions: options 
        });

        if (action?.type === 'ir.actions.act_window' && action.res_model) {
            try {
                // Skip jika viewType sudah ditentukan secara eksplisit dalam action
                if (!options.viewType) {
                    // Coba ambil dari sessionStorage dulu
                    const sessionData = sessionStorage.getItem(`view_preference_${action.res_model}`);
                    if (sessionData) {
                        const preference = JSON.parse(sessionData);
                        console.log('Found in sessionStorage:', preference);
                        options.viewType = preference.view_type;
                    }
                }

                const component = new LastViewPreference();
                console.log('Loading view preference for model:', action.res_model);
                
                const viewType = await component._loadViewPreference(action.res_model);
                console.log('Loaded view preference:', viewType);

                if (viewType && action.views) {
                    // Pastikan view type yang diminta tersedia
                    const availableViews = action.views.map(view => view[1]);
                    console.log('Available views:', availableViews);

                    if (availableViews.includes(viewType)) {
                        console.log(`Applying saved view: ${viewType}`);
                        options.viewType = viewType;
                    } else {
                        console.log(`Requested view ${viewType} not available. Using default.`);
                    }
                }
            } catch (error) {
                console.error('Error in doAction:', error);
                console.error('Stack:', error.stack);
            }
        } else {
            console.log('Not a window action or no model specified');
        }

        console.log('Final options being passed:', options);
        return super.doAction(action, options);
    }
});
