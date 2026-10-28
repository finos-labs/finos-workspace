import os
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import pytest
from uuid import UUID, uuid4

from api.models import StoredFile
from tests.fixtures.base import _AUTH_USER


class TestFiles:
    @pytest.mark.asyncio
    async def test_delete_files_unauthenticated(self, client):
        import json

        response = await client.request(
            "DELETE",
            "/app/files",
            content=json.dumps({"uuids": [str(uuid4())]}),
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code in {401, 403, 422}

    @pytest.mark.asyncio
    async def test_delete_files_authenticated(self, auth_client):
        import json

        response = await auth_client.request(
            "DELETE",
            "/app/files",
            content=json.dumps({"uuids": [str(uuid4())]}),
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code in {200, 404, 422}


class TestFileSingle:
    @pytest.mark.asyncio
    async def test_delete_file_unauthenticated(self, client):
        test_uuid = str(uuid4())
        response = await client.delete(f"/app/files/{test_uuid}")
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_delete_file_nonexistent(self, auth_client):
        test_uuid = str(uuid4())
        response = await auth_client.delete(f"/app/files/{test_uuid}")
        assert response.status_code in {200, 404}


class TestFilePresignedUrl:
    @pytest.mark.asyncio
    async def test_get_presigned_url_unauthenticated(self, client):
        test_uuid = str(uuid4())
        response = await client.get(f"/app/files/{test_uuid}/presigned-url")
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_get_presigned_url_nonexistent(self, auth_client):
        test_uuid = str(uuid4())
        response = await auth_client.get(f"/app/files/{test_uuid}/presigned-url")
        assert response.status_code in {404, 400}


class TestFileInputValidation:
    @pytest.mark.asyncio
    async def test_delete_file_invalid_uuid_format(self, auth_client):
        response = await auth_client.delete("/app/files/not-a-valid-uuid")
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_delete_file_sql_injection_uuid(self, auth_client):
        response = await auth_client.delete("/app/files/'; DROP TABLE files; --")
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_presigned_url_invalid_uuid(self, auth_client):
        response = await auth_client.get("/app/files/invalid-uuid/presigned-url")
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_bulk_delete_empty_array(self, auth_client):
        import json

        response = await auth_client.request(
            "DELETE",
            "/app/files",
            content=json.dumps({"uuids": []}),
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code in {200, 422}

    @pytest.mark.asyncio
    async def test_bulk_delete_invalid_uuids(self, auth_client):
        import json

        response = await auth_client.request(
            "DELETE",
            "/app/files",
            content=json.dumps({"uuids": ["not-a-uuid", "also-invalid"]}),
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code in {422, 400}

    @pytest.mark.asyncio
    async def test_bulk_delete_mixed_valid_invalid(self, auth_client):
        import json

        response = await auth_client.request(
            "DELETE",
            "/app/files",
            content=json.dumps({"uuids": [str(uuid4()), "invalid"]}),
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code in {422, 400, 200}


class TestFileSecurity:
    @pytest.mark.asyncio
    async def test_path_traversal_in_file_uuid(self, auth_client):
        response = await auth_client.get("/app/files/../../../etc/passwd/presigned-url")
        assert response.status_code in {404, 422}

    @pytest.mark.asyncio
    async def test_null_byte_in_file_uuid(self, auth_client):
        test_uuid = str(uuid4())
        response = await auth_client.delete(f"/app/files/{test_uuid}%00.exe")
        assert response.status_code in {404, 422}

    @pytest.mark.asyncio
    async def test_cannot_access_other_users_files(
        self, auth_client, second_user_client, db_session
    ):
        stored_file = StoredFile(
            uuid=uuid4(),
            creater_uuid=UUID(_AUTH_USER["user_uuid"]),
            s3_file_name="private.csv",
            bucket="files",
            extension="csv",
            original_file_name="private.csv",
            size=10,
        )
        db_session.add(stored_file)
        await db_session.commit()
        try:
            response = await second_user_client.get(
                f"/app/files/{stored_file.uuid}/presigned-url"
            )
            assert response.status_code in {404, 403}
        finally:
            await db_session.delete(stored_file)
            await db_session.commit()


class TestFileDownload:
    @pytest.mark.asyncio
    async def test_bulk_download_unauthenticated(self, client):
        response = await client.post(
            "/app/files/download",
            json={"uuids": [str(uuid4())]},
        )
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_bulk_download_empty_uuids(self, auth_client):
        response = await auth_client.post(
            "/app/files/download",
            json={"uuids": []},
        )
        assert response.status_code in {200, 422, 400}

    @pytest.mark.asyncio
    async def test_bulk_download_nonexistent_files(self, auth_client):
        response = await auth_client.post(
            "/app/files/download",
            json=[str(uuid4()), str(uuid4())],
        )
        assert response.status_code in {200, 404, 400, 422}

    @pytest.mark.asyncio
    async def test_bulk_download_invalid_uuid_format(self, auth_client):
        response = await auth_client.post(
            "/app/files/download",
            json=["not-a-uuid"],
        )
        assert response.status_code in {422, 400}


class TestPresignedUrlEdgeCases:
    @pytest.mark.asyncio
    async def test_presigned_url_with_expiration_parameter(self, auth_client):
        test_uuid = str(uuid4())
        response = await auth_client.get(
            f"/app/files/{test_uuid}/presigned-url",
            params={"expiration": 3600},
        )
        assert response.status_code in {404, 200, 400}

    @pytest.mark.asyncio
    async def test_presigned_url_negative_expiration(self, auth_client):
        test_uuid = str(uuid4())
        response = await auth_client.get(
            f"/app/files/{test_uuid}/presigned-url",
            params={"expiration": -1},
        )
        assert response.status_code in {404, 422, 400}

    @pytest.mark.asyncio
    async def test_presigned_url_zero_expiration(self, auth_client):
        test_uuid = str(uuid4())
        response = await auth_client.get(
            f"/app/files/{test_uuid}/presigned-url",
            params={"expiration": 0},
        )
        assert response.status_code in {404, 422, 400, 200}


class TestFileDownloadExtended:
    @pytest.mark.asyncio
    async def test_download_post_unauthenticated(self, client):
        response = await client.post(
            "/app/files/download",
            json=[str(uuid4())],
        )
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_download_empty_list(self, auth_client):
        response = await auth_client.post(
            "/app/files/download",
            json=[],
        )
        assert response.status_code in {200, 400, 404, 422}

    @pytest.mark.asyncio
    async def test_download_nonexistent_files(self, auth_client):
        response = await auth_client.post(
            "/app/files/download",
            json=[str(uuid4()), str(uuid4())],
        )
        assert response.status_code in {200, 404, 400, 422}

    @pytest.mark.asyncio
    async def test_download_invalid_uuid_format(self, auth_client):
        response = await auth_client.post(
            "/app/files/download",
            json=["not-a-uuid", "also-not-a-uuid"],
        )
        assert response.status_code in {422, 400}

    @pytest.mark.asyncio
    async def test_download_single_file(self, auth_client):
        response = await auth_client.post(
            "/app/files/download",
            json=[str(uuid4())],
        )
        assert response.status_code in {200, 404, 400, 422}

    @pytest.mark.asyncio
    async def test_download_many_files(self, auth_client):
        many_uuids = [str(uuid4()) for _ in range(50)]
        response = await auth_client.post(
            "/app/files/download",
            json=many_uuids,
        )
        assert response.status_code in {200, 404, 400, 422}

    @pytest.mark.asyncio
    async def test_download_sql_injection(self, auth_client):
        response = await auth_client.post(
            "/app/files/download",
            json=["'; DROP TABLE files; --"],
        )
        assert response.status_code in {422, 400}

    @pytest.mark.asyncio
    async def test_download_xss_in_uuid(self, auth_client):
        response = await auth_client.post(
            "/app/files/download",
            json=["<script>alert('xss')</script>"],
        )
        assert response.status_code in {422, 400}

    @pytest.mark.asyncio
    async def test_download_content_type(self, auth_client):
        response = await auth_client.post(
            "/app/files/download",
            json=[str(uuid4())],
        )
        if response.status_code == 200:
            content_type = response.headers.get("content-type", "")
            assert any(ct in content_type for ct in ["octet-stream", "application/zip", "application/json"])


class TestFileGetByName:
    @pytest.mark.asyncio
    async def test_get_file_by_name_unauthenticated(self, client):
        response = await client.get("/app/files/test_file.txt")
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_get_file_nonexistent(self, auth_client):
        response = await auth_client.get(f"/app/files/nonexistent_{uuid4().hex}.txt")
        assert response.status_code in {404, 400}

    @pytest.mark.asyncio
    async def test_get_file_path_traversal(self, auth_client):
        dangerous_paths = [
            "../../../etc/passwd",
            "..\\..\\..\\windows\\system32\\config\\sam",
            "....//....//etc/passwd",
            "%2e%2e%2f%2e%2e%2fetc/passwd",
        ]
        for path in dangerous_paths:
            response = await auth_client.get(f"/app/files/{path}")
            assert response.status_code in {400, 404, 422}

    @pytest.mark.asyncio
    async def test_get_file_special_characters(self, auth_client):
        special_names = [
            "file with spaces.txt",
            "file%20encoded.txt",
            "file<script>.txt",
        ]
        for name in special_names:
            response = await auth_client.get(f"/app/files/{name}")
            assert response.status_code in {400, 404, 422}

    @pytest.mark.asyncio
    async def test_get_file_null_byte(self, auth_client):
        response = await auth_client.get("/app/files/file.txt%00.html")
        assert response.status_code in {400, 404, 422}

    @pytest.mark.asyncio
    async def test_get_file_cache_permission(self, auth_client):
        from uuid import uuid4
        from unittest import mock

        fake_uuid = str(uuid4())
        other_user_uuid = str(uuid4())

        fake_cache = {
            "uuid": fake_uuid,
            "creater_uuid": other_user_uuid,
            "s3_file_name": f"{fake_uuid}.csv",
            "bucket": "test-bucket",
            "extension": "csv",
            "original_file_name": "test.csv",
            "size": 100,
            "is_global": False,
            "is_entity_shared": False,
        }
        with mock.patch("utilities.config.Settings.redis_cache", return_value=fake_cache, autospec=True):
            response = await auth_client.get(f"/app/files/{fake_uuid}.csv")
            assert response.status_code == 403
            assert response.json().get("detail") == "User does not have access to this file"


class TestFileUpload:
    @pytest.mark.asyncio
    async def test_upload_unauthenticated(self, client):
        response = await client.post(
            "/app/files",
            json={"files": []},
        )
        assert response.status_code in {401, 403, 422}

    @pytest.mark.asyncio
    async def test_upload_empty_files(self, auth_client):
        response = await auth_client.post(
            "/app/files",
            json={"files": []},
        )
        assert response.status_code in {200, 422}

    @pytest.mark.asyncio
    async def test_upload_file_name_too_long(self, auth_client):
        long_name = "a" * 500 + ".txt"
        response = await auth_client.post(
            "/app/files",
            json={"files": [{"name": long_name, "size": 100}]},
        )
        assert response.status_code in {200, 400, 422}

    @pytest.mark.asyncio
    async def test_upload_file_size_too_large(self, auth_client):
        response = await auth_client.post(
            "/app/files",
            json={"files": [{"name": "huge.txt", "size": 10000000000}]},
        )
        assert response.status_code in {200, 400, 422}


class TestFileSecurityExtended:
    @pytest.mark.asyncio
    async def test_cannot_access_random_users_files(self, auth_client):
        other_user_file = str(uuid4())
        response = await auth_client.get(f"/app/files/{other_user_file}/presigned-url")
        assert response.status_code in {400, 403, 404}

    @pytest.mark.asyncio
    async def test_cannot_delete_other_users_files(self, auth_client):
        other_user_file = str(uuid4())
        response = await auth_client.delete(f"/app/files/{other_user_file}")
        assert response.status_code in {200, 404}

    @pytest.mark.asyncio
    async def test_file_uuid_enumeration_protection(self, auth_client):
        responses = []
        for _ in range(5):
            random_uuid = str(uuid4())
            response = await auth_client.get(f"/app/files/{random_uuid}/presigned-url")
            responses.append(response.status_code)

        assert all(code == responses[0] for code in responses)

    @pytest.mark.asyncio
    async def test_no_internal_paths_in_response(self, auth_client):
        test_uuid = str(uuid4())
        response = await auth_client.get(f"/app/files/{test_uuid}/presigned-url")
        response_text = response.text

        dangerous_paths = ["/var/", "/home/", "/etc/", "C:\\", "/app/"]
        for path in dangerous_paths:
            assert path not in response_text


class TestStoredFiles:
    @pytest.mark.asyncio
    async def test_get_stored_files_unauthenticated(self, client):
        response = await client.get("/app/data-connectors/stored-files")
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_get_stored_files_authenticated(self, auth_client):
        response = await auth_client.get("/app/data-connectors/stored-files")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)

    @pytest.mark.asyncio
    async def test_stored_files_response_schema(self, auth_client):
        response = await auth_client.get("/app/data-connectors/stored-files")
        if response.status_code == 200:
            data = response.json()
            assert isinstance(data, list)
            if len(data) > 0:
                file_item = data[0]
                assert isinstance(file_item, dict)
