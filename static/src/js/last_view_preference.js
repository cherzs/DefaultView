/** @odoo-module **/

import { registry } from "@web/core/registry";
import { patch } from "@web/core/utils/patch";
import { useService } from "@web/core/utils/hooks";
import { Component } from "@odoo/owl";

class LastViewPreference extends Component {
    setup() {
        this.orm = useService("orm");
        this.rpc = useService("rpc");
        this.notification = useService("notification");
        this.action = useService("action");
        
        // Listen for view changes
        this.env.bus.addEventListener('ACTION_MANAGER:UI-UPDATED', () => {
            this._saveCurrentView();
        });
    }

    async _saveCurrentView() {
        const actionService = this.env.services.action;
        if (!actionService?.currentController) return;

        const controller = actionService.currentController;
        const viewType = controller.view?.type;
        const model = controller.action?.res_model;

        if (viewType && model) {
            try {
                console.log(`Saving view preference: ${viewType} for ${model}`);
                const response = await this.rpc('/save/last_view', {
                    model_name: model,
                    view_type: viewType
                });

                if (response) {
                    console.log('View preference saved successfully');
                    this.notification.add(`View preference saved: ${viewType}`, {
                        type: 'success',
                        sticky: false,
                    });
                }
            } catch (error) {
                console.error('Error saving view preference:', error);
            }
        }
    }

    async loadSavedView(model) {
        try {
            const savedView = await this.orm.call(
                'res.users',
                'get_last_view',
                [[this.env.session.uid], model]
            );
    
            if (savedView) {
                console.log(`Found saved view: ${savedView} for ${model}`);
                return savedView;
            }
        } catch (error) {
            console.error('Error loading saved view:', error);
        }
        return false;
    }

}

LastViewPreference.template = "DefaultView.LastViewPreference";

// Register the component
registry.category("main_components").add("LastViewPreference", {
    Component: LastViewPreference,
});

// Patch the action service
const actionService = registry.category("services").get("action");
patch(actionService, {
    async doAction(action, options = {}) {
        console.log('Inside patched doAction');
        
        if (action?.res_model && !options.viewType) {
            console.log(`Fetching saved view for model: ${action.res_model}`);
            try {
                const orm = this.env.services.orm;
                const savedView = await orm.call(
                    'res.users',
                    'get_last_view',
                    [[this.env.session.uid], action.res_model]
                );

                if (savedView) {
                    console.log(`Applying saved view: ${savedView} for ${action.res_model}`);
                    options.viewType = savedView;
                    if (action.views) {
                        action.views = action.views.filter(view => view[1] === savedView).concat(
                            action.views.filter(view => view[1] !== savedView)
                        );
                    }
                }
            } catch (error) {
                console.error('Error loading saved view:', error);
            }
        }
        return super.doAction(action, options);
    }
});
