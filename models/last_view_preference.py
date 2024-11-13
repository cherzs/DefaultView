from odoo import models, fields, api
import logging

_logger = logging.getLogger(__name__)

class LastViewPreference(models.Model):
    _name = 'last.view.preference'
    _description = 'Last View Preference'
    _rec_name = 'model_name'
    
    user_id = fields.Many2one('res.users', string='User', required=True, default=lambda self: self.env.user)
    model_name = fields.Char(string='Model Name', required=True)
    view_type = fields.Selection([
        ('list', 'List'),
        ('kanban', 'Kanban'),
        ('form', 'Form'),
        ('calendar', 'Calendar'),
        ('pivot', 'Pivot'),
        ('graph', 'Graph'),
    ], string='View Type', required=True)

    _sql_constraints = [
        ('unique_user_model', 'unique(user_id, model_name)', 'Only one preference per user per model is allowed!')
    ]

    @api.model
    def get_last_view(self, model_name):
        if not model_name:
            return False
            
        preference = self.search([
            ('user_id', '=', self.env.uid),
            ('model_name', '=', model_name)
        ], limit=1)
        
        return preference and {
            'view_type': preference.view_type,
            'model_name': preference.model_name
        }

    @api.model
    def save_last_view(self, model_name, view_type):
        if not model_name or not view_type:
            return False

        vals = {
            'user_id': self.env.uid,
            'model_name': model_name,
            'view_type': view_type
        }

        preference = self.search([
            ('user_id', '=', self.env.uid),
            ('model_name', '=', model_name)
        ], limit=1)

        if preference:
            preference.write(vals)
        else:
            self.create(vals)
        
        return True


class ResUsers(models.Model):
    _inherit = 'res.users'

    def set_last_view(self, model_name, view_type):
        _logger.info(f'Setting last view for user {self.name} ({self.id}): {model_name} - {view_type}')
        
        # Menggunakan search dan write/create alih-alih SQL mentah
        view_preference = self.env['last.view.preference'].search([
            ('user_id', '=', self.id),
            ('model_name', '=', model_name)
        ], limit=1)

        if view_preference:
            # Jika preferensi sudah ada, lakukan update
            view_preference.write({'view_type': view_type})
        else:
            # Jika preferensi belum ada, lakukan create
            self.env['last.view.preference'].create({
                'user_id': self.id,
                'model_name': model_name,
                'view_type': view_type
            })
        
        _logger.info(f'View preference saved for {model_name}: {view_type}')
        return True

    def get_last_view(self, model_name):
        _logger.info(f'Getting last view for user {self.name} ({self.id}): {model_name}')
        
        # Menggunakan pencarian ORM untuk mendapatkan preferensi terakhir
        view_preference = self.env['last.view.preference'].search([
            ('user_id', '=', self.id),
            ('model_name', '=', model_name)
        ], order="write_date desc", limit=1)
        
        if view_preference:
            view_type = view_preference.view_type
            _logger.info(f'Found view preference: {view_type}')
            return view_type
        
        _logger.info('No view preference found')
        return False
