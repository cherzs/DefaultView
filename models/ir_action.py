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

                # Get current views and view_mode
                current_views = action_data.get('views', [])
                current_view_mode = action_data.get('view_mode', '')
                
                if current_view_mode and preferred_view in current_view_mode:
                    # Update context to force the desired view type
                    if not action_data.get('context'):
                        action_data['context'] = {}
                    action_data['context'].update({
                        'view_type': preferred_view,
                        'force_view_type': preferred_view,
                        'initial_view': preferred_view
                    })

                    _logger.info(f"View preference applied for {model_name} (action_id: {action_id})")

        except Exception as e:
            _logger.error(f"Error applying view preference: {str(e)}")

        return action_data

