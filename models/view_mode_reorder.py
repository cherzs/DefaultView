from odoo import models, api
import logging

_logger = logging.getLogger(__name__)

class ViewModeReorderMixin(models.AbstractModel):
    _name = 'view.mode.reorder.mixin'
    _description = 'Mixin to reorder view modes based on user preference'

    def reorder_view_mode(self, action_data):
        """Reorder view mode based on last view preference."""
        if not action_data or not action_data.get('res_model'):
            return action_data

        try:
            model_name = action_data.get('res_model')
            action_id = action_data.get('id')

            # Get last view preference
            last_preference = self.env['last.view.preference'].search([
                ('model_name', '=', model_name),
                ('action_id', '=', action_id),
                ('active', '=', True),
                ('user_id', '=', self.env.uid)
            ], limit=1)

            if last_preference and last_preference.view_type != 'form':
                # Get current views and view_mode
                current_views = action_data.get('views', [])
                current_view_mode = action_data.get('view_mode', '')

                if not current_view_mode:
                    return action_data

                # Split view_mode into list
                view_types = current_view_mode.split(',')

                # Check if preferred view exists in current views
                if last_preference.view_type in view_types:
                    # Remove preferred view from current position
                    view_types.remove(last_preference.view_type)
                    # Add it to the beginning (except 'form' which stays at its position)
                    view_types.insert(0, last_preference.view_type)

                    # Create new view_mode string
                    new_view_mode = ','.join(view_types)

                    # Reorder views array to match new view_mode order
                    view_dict = {v[1]: v for v in current_views}
                    new_views = []
                    for vtype in view_types:
                        if vtype in view_dict:
                            new_views.append(view_dict[vtype])
                        else:
                            new_views.append([False, vtype])

                    # Update action data
                    action_data['view_mode'] = new_view_mode
                    action_data['views'] = new_views

                    _logger.info(
                        f"Views reordered for {model_name} (action_id: {action_id}):\n"
                        f"Original view_mode: {current_view_mode}\n"
                        f"New view_mode: {new_view_mode}\n"
                        f"New views: {new_views}"
                    )

                    # Update database
                    self.browse(action_id).write({
                        'view_mode': new_view_mode
                    })

                    # Clear caches
                    self.invalidate_cache(['view_mode', 'views'], [action_id])
                    self.env.registry.clear_caches()

        except Exception as e:
            _logger.error(f"Error reordering views: {str(e)}")

        return action_data
