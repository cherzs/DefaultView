from odoo import models, fields, api
import logging
from odoo.exceptions import ValidationError

_logger = logging.getLogger(__name__)

class IrActionsActWindowInherit(models.Model):
    _inherit = 'ir.actions.act_window'

    def read(self, fields=None, load='_classic_read'):
        """Override read to force view mode order."""
        result = super().read(fields, load)
        
        # Handle single record
        if isinstance(result, dict):
            return self._force_view_mode(result)
        # Handle multiple records
        return [self._force_view_mode(res) for res in result]

    def _force_view_mode(self, action_data):
        """Force view mode order based on last view preference."""
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
            ], limit=1, order='write_date DESC')

            if last_preference:
                preferred_view = last_preference.view_type
                if preferred_view == 'tree':
                    preferred_view = 'list'

                # Get current views and view_mode
                current_views = action_data.get('views', [])
                current_view_mode = action_data.get('view_mode', '')
                
                if current_view_mode and preferred_view in current_view_mode:
                    # Split view_mode into list
                    view_types = current_view_mode.split(',')
                    
                    # Remove preferred view from current position
                    if preferred_view in view_types:
                        view_types.remove(preferred_view)
                        # Add it to the beginning
                        view_types.insert(0, preferred_view)
                    
                    # Create new view_mode string
                    new_view_mode = ','.join(view_types)
                    
                    # Reorder views array
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
                    
                    # Force initial view type in context
                    if not action_data.get('context'):
                        action_data['context'] = {}
                    action_data['context'].update({
                        'view_type': preferred_view,
                        'force_view_type': preferred_view
                    })

                    _logger.info(f"Views reordered for {model_name} (action_id: {action_id})")

        except Exception as e:
            _logger.error(f"Error reordering views: {str(e)}")

        return action_data

